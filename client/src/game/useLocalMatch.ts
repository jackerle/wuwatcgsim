// A match played by two people at one screen, run entirely in this tab.
//
// The bookkeeping around the engine — holding a half-finished move while its
// question is open, deciding who may act — is the same job the server does,
// so it is the same code: MatchSession, out of `shared`. This hook is only
// the React wrapper around it.
//
// Nothing is filtered here. Both players are sat at the same screen, so the
// board gets the whole state and the perspective toggle decides which hand is
// face-up. Over the network that would be a lie; see useNetMatch.
//
// MatchSession mutates in place, so a version counter is what tells React
// something moved — cloning the whole board on every step just to get a new
// object identity would be pure waste.

import { useCallback, useMemo, useRef, useState } from "react";
import {
  MatchSession,
  SEATS,
  starterDeck,
  type ChoiceAnswer,
  type MatchIntent,
  type Seat,
} from "@wuwatcg/shared";
import { SEAT_FALLBACK_NAMES, type MatchController } from "./matchController";

export interface LocalMatchOptions {
  /** The character each seat leads with. */
  picks: Record<Seat, string>;
  seed?: number;
}

function deal(options: LocalMatchOptions): MatchSession {
  const seed = options.seed ?? 1;
  // The hotseat screen still picks a character rather than a deck — it is
  // there to try cards out, not to play a built list — so a ready-made deck
  // stands in for one.
  return MatchSession.deal(
    `local-${seed}`,
    { p1: starterDeck(options.picks.p1), p2: starterDeck(options.picks.p2) },
    seed
  );
}

export function useLocalMatch(options: LocalMatchOptions): MatchController {
  const session = useRef<MatchSession | null>(null);
  if (!session.current) session.current = deal(options);

  const [version, bump] = useState(0);
  const [viewing, setViewing] = useState<Seat>(SEATS[0]);
  const touch = useCallback(() => bump((n) => n + 1), []);

  const send = useCallback(
    (playerId: string, intent: MatchIntent) => {
      session.current?.apply(playerId as Seat, intent);
      touch();
    },
    [touch]
  );

  const answer = useCallback(
    (choice: ChoiceAnswer) => {
      const asked = session.current?.question?.choice.playerId as Seat | undefined;
      if (!asked) return;
      session.current?.answer(asked, choice);
      touch();
    },
    [touch]
  );

  const cancel = useCallback(() => {
    const actor = session.current?.question?.actor;
    if (!actor) return;
    session.current?.cancel(actor);
    touch();
  }, [touch]);

  const { p1, p2 } = options.picks;
  const restart = useCallback(() => {
    session.current = deal({ picks: { p1, p2 }, seed: Math.floor(Math.random() * 1e9) });
    setViewing(SEATS[0]);
    touch();
  }, [p1, p2, touch]);

  const current = session.current;

  return useMemo(
    () => ({
      shown: current.board,
      pending: current.question?.choice ?? null,
      askingSeat: current.question?.choice.playerId ?? null,
      manual: current.manual,
      log: current.log,
      error: current.lastError,
      names: SEAT_FALLBACK_NAMES,
      connected: { p1: true, p2: true },
      viewing,
      setViewing,
      canFlip: true,
      controls: SEATS,
      send,
      answer,
      cancel,
      restart,
      canRestart: true,
      chat: null,
      sendChat: () => {},
    }),
    // `version` is the signal: the session mutates in place, so nothing else
    // here changes identity when the board moves.
    [current, version, viewing, send, answer, cancel, restart]
  );
}
