import { useEffect, useRef } from "react";
import type { MatchState } from "@wuwatcg/shared";
import { playCardSfx } from "./sfx";

/**
 * The card sound for a hand changing size, either side: bigger is a draw or
 * a card an ability put into hand, smaller is a card laid down (committed,
 * charged, played into a combo). Read off the state, like the cut-ins, so it
 * sounds the same whoever's move it was. One sound per state change however
 * many hands moved. The reveal plays its own — see ClashRevealFx.
 */
export function useCardSfx(state: MatchState) {
  const previous = useRef<MatchState | null>(null);
  useEffect(() => {
    const before = previous.current;
    previous.current = state;
    if (!before || before.matchId !== state.matchId) return;
    const changed = Object.entries(state.boards).some(
      ([seat, board]) => board.hand.length !== (before.boards[seat]?.hand.length ?? board.hand.length)
    );
    if (changed) playCardSfx();
  }, [state]);
}
