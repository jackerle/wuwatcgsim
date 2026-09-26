// A lesson, as something the board can play: the MatchController the board
// already knows how to draw, plus the guide step to show beside it.
//
// The match runs in this tab like a bot match (see useBotMatch), with the
// director standing between the board and the session: every move from the
// board is offered to it first, and it refuses whatever the open step is not
// asking for. The opponent's moves come from the director's tick(), on a
// timer, so they happen at a pace that can be watched.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChoiceAnswer, MatchIntent } from "@wuwatcg/shared";
import { seatFallbackNames, type MatchController } from "../game/matchController";
import { useLang } from "../i18n/LanguageContext";
import { FOE, PLAYER, TutorialDirector, type GuideStep, type Lesson } from "./director";

/** Between the opponent's moves: long enough to see each one land. */
const FOE_PACE_MS = 700;

export interface TutorialMatch {
  match: MatchController;
  step: GuideStep | null;
  /** Position of the open step, for "3 / 31". */
  index: number;
  total: number;
  finished: boolean;
  next: () => void;
  /** Goes up every time a move is refused — the guide shakes to point at itself. */
  nudges: number;
}

export function useTutorialMatch(lesson: Lesson): TutorialMatch {
  const { lang, t } = useLang();
  const director = useRef<TutorialDirector | null>(null);
  if (!director.current || director.current.lesson !== lesson) {
    director.current = new TutorialDirector(lesson);
  }

  const [version, bump] = useState(0);
  const touch = useCallback(() => bump((n) => n + 1), []);
  const [nudges, setNudges] = useState(0);
  const [refused, setRefused] = useState(false);

  // The opponent's turn to do something: one move per beat.
  useEffect(() => {
    const live = director.current;
    if (!live?.busy) return;
    const timer = setTimeout(() => {
      if (live.tick()) touch();
    }, FOE_PACE_MS);
    return () => clearTimeout(timer);
  }, [version, touch]);

  const send = useCallback(
    (playerId: string, intent: MatchIntent) => {
      if (playerId !== PLAYER) return;
      const live = director.current;
      if (!live) return;
      if (live.play(intent)) {
        setRefused(false);
        touch();
        return;
      }
      // PlayGame's own moves (the draw, the reveal, the end of a turn with
      // nothing left in it) arrive here too while a step is being read. They
      // are not the player's doing and are retried once the step moves on
      // (see next), so they are dropped quietly — and without a redraw, which
      // would only hand PlayGame a new board to retry them on at once.
      const automatic = ["startTurn", "resolveCounter", "endTurn"].includes(intent.kind) && live.holding;
      if (automatic) return;
      setRefused(true);
      setNudges((n) => n + 1);
    },
    [touch]
  );

  const answer = useCallback(
    (choice: ChoiceAnswer) => {
      director.current?.answer(choice);
      touch();
    },
    [touch]
  );

  // No taking a move back mid-question: the step it answered has already
  // moved on, and the lesson would be left waiting for a board that never
  // comes (a Level Up undone leaves no Lv.1 card to level up from).
  const cancel = useCallback(() => {}, []);

  const restart = useCallback(() => {
    director.current = new TutorialDirector(lesson);
    setRefused(false);
    touch();
  }, [lesson, touch]);

  const next = useCallback(() => {
    director.current?.next();
    setRefused(false);
    // A new board object even when nothing moved: PlayGame retries the moves
    // it makes by itself whenever the board changes, and those were refused
    // while the step was being read.
    touch();
  }, [touch]);

  const live = director.current;

  const match = useMemo<MatchController>(() => {
    const session = live.session;
    const update = session.updateFor(PLAYER);
    return {
      shown: update.view,
      pending: update.pending,
      askingSeat: update.askingSeat,
      manual: update.manual,
      log: update.log,
      error: refused ? t("tutorial.followGuide") : update.error,
      names: { ...seatFallbackNames(lang), [PLAYER]: t("bot.you"), [FOE]: t("tutorial.opponent") },
      connected: { p1: true, p2: true },
      viewing: PLAYER,
      setViewing: () => {},
      canFlip: false,
      controls: [PLAYER],
      send,
      answer,
      cancel,
      canCancel: false,
      restart,
      canRestart: true,
      chat: null,
      sendChat: () => {},
      debugSnapshot: () => ({
        mode: "tutorial",
        lesson: live.lesson.id,
        step: live.step?.id ?? null,
        state: session.state,
        question: session.question,
        log: session.log,
      }),
    };
    // `version` is the signal: the session mutates in place.
  }, [live, version, refused, send, answer, cancel, restart, lang, t]);

  return {
    match,
    step: live.step,
    index: live.at,
    total: live.lesson.steps.length,
    finished: live.finished,
    next,
    nudges,
  };
}
