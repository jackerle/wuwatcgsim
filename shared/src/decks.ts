// Ready-made decks, built from the real card database.
//
// Deck building is its own screen and doesn't exist yet, so these stand in:
// pick a character, take every card printed for them, and repeat that list
// until it reaches the legal 40. Everything here is real printed data — the
// same ids, stats and abilities the engine resolves against.

import { ALL_CARDS } from "./cardDb";
import type { CardDef } from "./cardDef";
import { CHARACTERS_IN_PLAY, type ActionCard, type CharacterCard } from "./game";
import { ACTION_DECK_SIZE } from "./rules";

export interface Starter {
  /** The three characters that take the field. */
  characters: string[];
  characterDeck: CharacterCard[];
  actionDeck: ActionCard[];
}

export function toCharacterCard(def: CardDef): CharacterCard {
  if (def.type !== "leader") throw new Error(`${def.id} is not a character card`);
  return { id: def.id, name: def.name, level: def.level, imageId: def.imageId };
}

export function toActionCard(def: CardDef): ActionCard {
  if (def.type !== "action") throw new Error(`${def.id} is not an action card`);
  return {
    id: def.id,
    name: def.name,
    color: def.color,
    cost: def.cost,
    damage: def.attack,
    // Blue prints no Speed; combat never reads it for a blue-on-blue clash.
    speed: def.speed ?? 0,
    imageId: def.imageId,
  };
}

/** Every character that has enough cards printed to field a legal deck. */
export function playableCharacters(): string[] {
  const names = new Set<string>();
  for (const card of ALL_CARDS) {
    if (card.type !== "leader" || !card.character) continue;
    if (buildable(card.character)) names.add(card.character);
  }
  return [...names].sort();
}

export function cardsFor(character: string) {
  const mine = ALL_CARDS.filter((card) => card.character === character);
  return {
    characters: mine.filter((card) => card.type === "leader"),
    actions: mine.filter((card) => card.type === "action"),
  };
}

function buildable(character: string): boolean {
  const { characters, actions } = cardsFor(character);
  return actions.length > 0 && characters.some((card) => card.level === 0);
}

/**
 * A legal starting deck built around a lead character.
 *
 * Three characters take the field at the start, so a deck needs three, each
 * with a Level 0 card to begin on. The named one comes first and is the
 * Leader; two more are picked to fill the back, and the action deck repeats
 * all three characters' printed cards up to the legal 40.
 *
 * Card order is fixed, so a reload deals the same game and a bug stays
 * reproducible — shuffle() is what makes it a real deal.
 */
export function starterFor(character: string): Starter {
  if (!buildable(character)) throw new Error(`${character} has too few cards for a deck`);

  const partners = playableCharacters().filter((name) => name !== character);
  const roster = [character, ...partners.slice(0, CHARACTERS_IN_PLAY - 1)];
  if (roster.length < CHARACTERS_IN_PLAY) {
    throw new Error(`not enough characters printed to field ${CHARACTERS_IN_PLAY}`);
  }

  const characterDeck: CharacterCard[] = [];
  const actionPool: CardDef[] = [];
  for (const name of roster) {
    const { characters, actions } = cardsFor(name);
    characterDeck.push(...characters.map(toCharacterCard));
    actionPool.push(...actions);
  }

  const actionDeck: ActionCard[] = [];
  while (actionDeck.length < ACTION_DECK_SIZE) {
    actionDeck.push(toActionCard(actionPool[actionDeck.length % actionPool.length]));
  }

  return { characters: roster, characterDeck, actionDeck };
}

/**
 * Shuffles in place with a seeded generator, so the same seed always deals
 * the same game. Math.random would make a reported bug unreproducible.
 */
export function shuffle<T>(cards: T[], seed: number): T[] {
  const out = [...cards];
  let random = seed >>> 0;
  const next = () => {
    // xorshift32 — small, fast, and good enough to deal cards with.
    random ^= random << 13;
    random ^= random >>> 17;
    random ^= random << 5;
    return (random >>> 0) / 0x100000000;
  };
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
