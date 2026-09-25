// When a turn has nothing left in it.

import { legalIntents, type MatchState } from "@wuwatcg/shared";

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
 * there is no follow-up window — the clash was lost or drawn, the win gave no
 * follow-ups, they are used up, or an effect has shut them off.
 *
 * Only what the table can see. A window that is open stays the player's to
 * close even when nothing in their hand could use it: ending it on its own
 * the moment the hand ran dry would tell the other side exactly that.
 *
 * PlayGame ends such a turn by itself, and ControlBar shows no End Turn for
 * it. Both read this, so the button never disappears without the turn
 * actually moving on.
 */
export function nothingLeftToDo(state: MatchState): boolean {
  if (state.winnerId || (state.phase !== "combo" && state.phase !== "end")) return false;
  const legal = legalIntents(state, turnEnder(state));
  return legal.includes("endTurn") && !legal.includes("combo");
}
