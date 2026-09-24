// Small shared lookup: which card art represents a character.
//
// Used anywhere a character needs a face rather than just a name — the
// builder's character picker and the share image both want the same
// card, so this lives here instead of being copied into each screen.

import { cardsFor } from "@wuwatcg/shared";

/** The Lv.0 card, which is the one with the portrait people recognise. */
export function portraitOf(character: string): { id: string; imageId: string } | null {
  const base = cardsFor(character).characters.find((card) => card.level === 0);
  return base ? { id: base.id, imageId: base.imageId } : null;
}
