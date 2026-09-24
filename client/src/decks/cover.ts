// The three cards on a deck's cover in the deck list.

import { cardsFor } from "@wuwatcg/shared";
import type { SavedDeck } from "./storage";

export const COVER_SIZE = 3;

export interface CoverCard {
  id: string;
  imageId: string;
  name: string;
  level: number;
}

/** Every character card this deck could put on its cover, lowest level first. */
export function coverChoices(deck: SavedDeck): CoverCard[] {
  return deck.characters.flatMap((name) =>
    [...cardsFor(name).characters]
      .sort((a, b) => a.level - b.level)
      .map((card) => ({ id: card.id, imageId: card.imageId, name: card.name, level: card.level }))
  );
}

/**
 * What the cover shows: the player's own picks, as long as they still belong
 * to the deck (a character swapped out takes its cards with it); otherwise
 * each character at their highest level — the art that reads as "this deck"
 * best, and what a deck has before anyone picks.
 */
export function coverOf(deck: SavedDeck): CoverCard[] {
  const choices = coverChoices(deck);
  const byId = new Map(choices.map((card) => [card.id, card]));
  const picked = (deck.cover ?? []).map((id) => byId.get(id)).filter((card) => card !== undefined);
  if (picked.length > 0) return picked.slice(0, COVER_SIZE);
  return deck.characters.flatMap((name) => {
    const highest = [...cardsFor(name).characters].sort((a, b) => b.level - a.level)[0];
    return highest ? [byId.get(highest.id)!] : [];
  });
}
