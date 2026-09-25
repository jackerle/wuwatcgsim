// When a turn has nothing left in it.

import { legalIntents, whyUnplayable, type MatchState } from "@wuwatcg/shared";

/**
 * Who owns ending the turn right now: in the Combo Step, whoever won the
 * clash (they own their follow-ups and the End that closes them); otherwise
 * the turn player. See legalIntents.
 */
export function turnEnder(state: MatchState): string {
  return state.phase === "combo" && state.combo ? state.combo.playerId : state.turnPlayerId;
}

/**
 * The turn is over in all but name: End Turn is the only move left, because
 * there is no follow-up to make — no window, or no red card in hand the
 * engine would take (the same test the hand's combo click is gated on).
 *
 * PlayGame ends such a turn by itself, and ControlBar shows no End Turn for
 * it. Both read this, so the button never disappears without the turn
 * actually moving on.
 */
export function nothingLeftToDo(state: MatchState): boolean {
  if (state.winnerId || (state.phase !== "combo" && state.phase !== "end")) return false;
  const seat = turnEnder(state);
  const legal = legalIntents(state, seat);
  if (!legal.includes("endTurn")) return false;
  if (!legal.includes("combo")) return true;
  return !(state.boards[seat]?.hand ?? []).some(
    (card) => card.color === "red" && !whyUnplayable(state, card, seat)
  );
}
