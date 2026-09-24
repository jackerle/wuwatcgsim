// Life and hand changes worth calling out on the board: a hit, a heal, a card
// an ability put into someone's hand — each with the card that did it.
//
// Read off the battle log rather than diffed off the boards. The log is the
// one place that already knows the CAUSE: every line an ability writes is
// credited "[BP01-010]" (creditCard in match.ts), and the damage lines name
// their source outright. A board diff would know Life went down by 3 and
// nothing about why.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { LogLine } from "@wuwatcg/shared";

export type BoardEventKind = "damage" | "heal" | "toHand";

export interface BoardEvent {
  key: number;
  /** The seat it happened to — the engine writes seats, not names. */
  seat: string;
  kind: BoardEventKind;
  amount: number;
  /** The card that caused it; null when the log credits no single card. */
  cardId: string | null;
}

/** On screen this long, stagger included per event. Matches Board.css. */
export const BOARD_EVENT_MS = 1800;
/** Several at once for the same seat come in one after another. */
export const BOARD_EVENT_STAGGER_MS = 350;

const CARD = /\[([A-Z]{2}\d{2}-\d{3})[^\]]*\]/;

/**
 * The English text is the one matched: it is the same template as the Thai
 * (see LOG in shared/log.ts), and only has to be matched once. A line that is
 * not one of these is simply not an event.
 */
const PATTERNS: { kind: BoardEventKind; re: RegExp; needsCard: boolean }[] = [
  { kind: "damage", re: /^(\S+) takes (\d+) from /, needsCard: false },
  { kind: "heal", re: /^(\S+) heals (\d+) from /, needsCard: false },
  // The turn's own draw writes this same line with no card on it — that one
  // is the Draw Phase, not an ability, and is not called out.
  { kind: "toHand", re: /^(\S+) draws (\d+) card/, needsCard: true },
  { kind: "toHand", re: /^(\S+) takes the top (\d+) card\(s\) of their deck to hand/, needsCard: true },
  { kind: "toHand", re: /^(\S+) takes (\d+) card\(s\) from the trash to hand/, needsCard: true },
  { kind: "toHand", re: /^(\S+) searches their deck and takes (\d+) card/, needsCard: true },
];

export function parseBoardEvent(line: LogLine): Omit<BoardEvent, "key"> | null {
  for (const { kind, re, needsCard } of PATTERNS) {
    const match = re.exec(line.en);
    if (!match) continue;
    const amount = Number(match[2]);
    const cardId = CARD.exec(line.en)?.[1] ?? null;
    if (amount <= 0 || (needsCard && !cardId)) return null;
    return { seat: match[1], kind, amount, cardId };
  }
  return null;
}

/**
 * Turns new battle-log lines into on-board events.
 *
 * `paused` holds them back — the clash reveal and Level Up cut-ins cover the
 * board, and a hit that lands under one would never be seen. While held, the
 * Life a player is SHOWN lags by what has not played yet (`lifeLag`), so the
 * number drops at the moment the hit animates rather than behind the overlay.
 */
/**
 * The lines `next` has that `prev` did not. Not simply the ones past
 * prev.length: the session keeps only the last LOG_LIMIT lines, so a full log
 * gains one at the end and loses one at the front and its length never moves.
 * Instead, find where prev's tail lines up with next's head.
 */
function newLines(prev: LogLine[], next: LogLine[]): LogLine[] {
  const same = (a: LogLine, b: LogLine) => a.en === b.en && a.th === b.th;
  for (let drop = 0; drop <= prev.length; drop += 1) {
    const overlap = prev.length - drop;
    if (overlap > next.length) continue;
    let matches = true;
    for (let i = 0; i < overlap && matches; i += 1) matches = same(prev[drop + i], next[i]);
    if (matches) return next.slice(overlap);
  }
  return next;
}

export function useBoardEvents(
  log: LogLine[],
  matchId: string,
  paused: boolean
): { active: BoardEvent[]; lifeLag: Record<string, number> } {
  // Everything already in the log when the board first draws is history,
  // not news — a reconnect should not replay the whole match.
  const seen = useRef({ log, matchId });
  const nextKey = useRef(0);
  const [queued, setQueued] = useState<BoardEvent[]>([]);
  const [active, setActive] = useState<BoardEvent[]>([]);

  // Layout, so the lag is in place before the lower Life is ever painted —
  // otherwise the number would dip for a frame, jump back, then drop again.
  useLayoutEffect(() => {
    const before = seen.current;
    seen.current = { log, matchId };
    if (before.log === log) return;
    // A new deal starts from nothing; whatever was showing belongs to the
    // last one.
    if (before.matchId !== matchId) {
      setQueued([]);
      setActive([]);
      return;
    }
    const fresh = newLines(before.log, log)
      .map(parseBoardEvent)
      .filter((event) => event !== null)
      .map((event) => ({ ...event, key: nextKey.current++ }));
    if (fresh.length > 0) setQueued((current) => [...current, ...fresh]);
  }, [log, matchId]);

  useEffect(() => {
    if (paused || queued.length === 0) return;
    // Not released on the spot. The update that brings a hit is usually the
    // same one that starts the clash reveal, and the cut-in only reports
    // itself as playing a render later — releasing here would slip the hit
    // out in that gap, under the overlay. A beat's wait is cancelled by that
    // very report (`paused` flips, this effect cleans up).
    const timer = window.setTimeout(() => {
      const released = queued;
      setQueued([]);
      setActive((current) => [...current, ...released]);
      const keys = new Set(released.map((event) => event.key));
      const longest = BOARD_EVENT_MS + (released.length - 1) * BOARD_EVENT_STAGGER_MS;
      window.setTimeout(
        () => setActive((current) => current.filter((event) => !keys.has(event.key))),
        longest + 100
      );
    }, 60);
    return () => window.clearTimeout(timer);
  }, [paused, queued]);

  const lifeLag: Record<string, number> = {};
  for (const event of queued) {
    if (event.kind === "toHand") continue;
    lifeLag[event.seat] = (lifeLag[event.seat] ?? 0) + (event.kind === "damage" ? event.amount : -event.amount);
  }
  return { active, lifeLag };
}
