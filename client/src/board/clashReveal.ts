import type { ActionCard, MatchState } from "@wuwatcg/shared";

export interface ClashReveal {
  /** The opponent's card (drawn on top, where their board is), or null: laid nothing. */
  top: ActionCard | null;
  /** This screen's own card, or null. */
  bottom: ActionCard | null;
  /**
   * How the clash came out — winnerId null on a draw. null altogether when
   * the board being shown has not decided it yet (see clashRevealBetween):
   * the cards still turn over, just without a verdict.
   */
  result: { winnerId: string | null } | null;
}

/**
 * The Counter Phase's reveal, if it happened between these two boards — the
 * two cards that turned up, and how the clash came out as far as `after`
 * knows. Kept apart from ClashRevealFx so the detection can be exercised
 * against the real engine without a browser.
 */
export function clashRevealBetween(
  before: MatchState,
  after: MatchState,
  top: string,
  bottom: string
): ClashReveal | null {
  // The reveal is both players' "committed" flags going from set to clear
  // — resolveCounter() clears them the moment it turns the cards up. Not
  // the phase changing: when an ability asks something part-way through
  // ([Counter], [Judgement]...), the player being asked is shown the
  // half-resolved board (the step's `preview`), where the cards are already
  // up but the phase is still "counter". Waiting for the phase would let
  // that question in ahead of the reveal.
  const bothWere = before.committed[top] && before.committed[bottom];
  const bothClear = !after.committed[top] && !after.committed[bottom];
  if (before.phase !== "counter" || !bothWere || !bothClear) return null;
  const topCard = after.actionZone[top]?.[0] ?? null;
  const bottomCard = after.actionZone[bottom]?.[0] ?? null;
  if (!topCard && !bottomCard) return null;
  // A half-resolved board may not have got as far as deciding the clash —
  // [Counter] asks before it is compared — and its lastBattle is then the
  // previous one. Only trust it when it names these very cards.
  const battle = after.lastBattle;
  const settled =
    battle !== null &&
    (battle.cardIdByPlayer[top] ?? null) === (topCard?.id ?? null) &&
    (battle.cardIdByPlayer[bottom] ?? null) === (bottomCard?.id ?? null);
  return {
    top: topCard,
    bottom: bottomCard,
    result: settled ? { winnerId: battle.winnerId } : null,
  };
}
