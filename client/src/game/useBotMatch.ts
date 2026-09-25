// A match against the bot, run entirely in this tab.
//
// The same engine as the hotseat screen (MatchSession, out of `shared`), with
// two differences that are the whole point:
//
// Only p1 is playable — `controls` says so, and the perspective toggle is
// gone, because there is nobody to hand the screen to.
//
// And the board this hands the player is `updateFor("p1")`, the filtered view
// a networked player would be sent, not the raw state. Hotseat gives the
// screen everything because both players are sat at it; here the other hand
// belongs to an opponent, and showing it would make the match pointless in
// exactly the way a bot that read YOUR hand would. The filtering runs in both
// directions and comes from the same function on both sides.
//
// The bot's own moves go through `botStep`, which takes its view the same way.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  MatchSession,
  botIntents,
  botStep,
  type ChoiceAnswer,
  type DeckList,
  type MatchIntent,
  type Seat,
} from "@wuwatcg/shared";
import { seatFallbackNames, type MatchController } from "./matchController";
import { useLang } from "../i18n/LanguageContext";

/** The seat the person is sat in. The bot takes the other one. */
const HUMAN: Seat = "p1";
const BOT: Seat = "p2";

/**
 * How long the bot sits on a move before making it.
 *
 * Not difficulty — the thinking itself, playing its options out (see
 * botSearch.ts), comes on top of this and takes a tenth to half a second —
 * but legibility: a turn is roughly ten moves, and a bot that played them all
 * in one frame would redraw the board four times between blinks and leave the
 * player reading the log to find out what happened. Together with the
 * thinking, long enough to follow, short enough not to be waiting on.
 */
const THINKING_MS = 250;

/**
 * How many refused moves in a row before the bot is declared stuck.
 *
 * `botStep` walks its own candidates until the engine takes one, so a refusal
 * that reaches here means every move it could think of was illegal — a bug,
 * not a slow turn. Better to stop and say so than to spin on it forever.
 */
const STUCK_LIMIT = 3;

export interface BotMatchOptions {
  /** The player's deck. */
  deck: DeckList;
  /** The bot's deck. */
  botDeck: DeckList;
  seed?: number;
}

function deal(options: BotMatchOptions): MatchSession {
  const seed = options.seed ?? Math.floor(Math.random() * 1e9);
  return MatchSession.deal(`bot-${seed}`, { p1: options.deck, p2: options.botDeck }, seed);
}

export function useBotMatch(options: BotMatchOptions): MatchController {
  const { lang, t } = useLang();
  const session = useRef<MatchSession | null>(null);
  if (!session.current) session.current = deal(options);

  const [version, bump] = useState(0);
  const touch = useCallback(() => bump((n) => n + 1), []);
  const stuck = useRef(0);
  const [jammed, setJammed] = useState(false);

  // The bot's turn to do something, on a timer so the board can be read on the
  // way past. Re-runs on every `version`, which is what makes one move lead to
  // the next.
  useEffect(() => {
    const live = session.current;
    if (!live || live.winnerId || jammed) return;

    const update = live.updateFor(BOT);
    // A question put to the player: nothing moves until they answer it.
    if (update.askingSeat && update.askingSeat !== BOT) return;
    const acts = update.pending !== null || botIntents(update.view, BOT).length > 0;
    if (!acts) return;

    const timer = setTimeout(() => {
      if (botStep(live, BOT)) {
        stuck.current = 0;
      } else {
        stuck.current += 1;
        if (stuck.current >= STUCK_LIMIT) setJammed(true);
      }
      touch();
    }, THINKING_MS);
    return () => clearTimeout(timer);
  }, [version, jammed, touch]);

  const send = useCallback(
    (playerId: string, intent: MatchIntent) => {
      // The board only ever offers the player their own seat, but a stray move
      // for the bot's would be the player playing both sides.
      if (playerId !== HUMAN) return;
      session.current?.apply(HUMAN, intent);
      touch();
    },
    [touch]
  );

  const answer = useCallback(
    (choice: ChoiceAnswer) => {
      session.current?.answer(HUMAN, choice);
      touch();
    },
    [touch]
  );

  const cancel = useCallback(() => {
    // Only the player who made the move may abandon its question — if the
    // bot's card is the one asking, dropping it is not the player's to do.
    const actor = session.current?.question?.actor;
    if (actor !== HUMAN) return;
    session.current?.cancel(HUMAN);
    touch();
  }, [touch]);

  const { deck, botDeck } = options;
  const restart = useCallback(() => {
    session.current = deal({ deck, botDeck });
    stuck.current = 0;
    setJammed(false);
    touch();
  }, [deck, botDeck, touch]);

  const current = session.current;

  return useMemo(() => {
    // Built in here rather than on every render: updateFor clones the board to
    // filter it, and the board only moves when `version` does.
    const update = current.updateFor(HUMAN);
    return {
      shown: update.view,
      pending: update.pending,
      askingSeat: update.askingSeat,
      manual: update.manual,
      log: update.log,
      error: jammed ? t("bot.stuck") : update.error,
      names: { ...seatFallbackNames(lang), [HUMAN]: t("bot.you"), [BOT]: t("bot.name") },
      connected: { p1: true, p2: true },
      viewing: HUMAN,
      // One seat, one screen, and the other hand was never sent here anyway.
      setViewing: () => {},
      canFlip: false,
      controls: [HUMAN],
      send,
      answer,
      cancel,
      canCancel: current.question?.actor === HUMAN,
      restart,
      canRestart: true,
      chat: null,
      sendChat: () => {},
    };
    // `version` is the signal: the session mutates in place, so nothing else
    // here changes identity when the board moves.
  }, [current, version, jammed, send, answer, cancel, restart, lang, t]);
}
