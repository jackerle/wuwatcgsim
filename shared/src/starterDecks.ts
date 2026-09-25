// Decks that ship with the app.
//
// A new player has no decks and a 40-card build is not a five-minute job, so
// there has to be something to play with on the first visit. These three are
// that: always present, the same for everyone, and never written to storage.
//
// They are kept as the very text the export button produces, and read back
// through parseDeck — the same path a pasted list takes. That is deliberate:
// a hand-written object literal would let a deck drift out of legality
// silently, whereas these go through the same parser and the same
// deckIssues() check every imported deck does, and test-decklist.ts asserts
// all three come out playable. Editing one is editing a block of text that a
// player could have pasted in themselves.

import { parseDeck, type DeckList } from "./deckList";

/**
 * Prefix on every built-in deck's id.
 *
 * The client keeps its own decks in localStorage and merges these in on top,
 * so ids from the two sources share one namespace and must not collide.
 */
export const STARTER_DECK_ID_PREFIX = "starter-";

/** Is this a built-in deck rather than one the player saved? */
export function isStarterDeckId(id: string): boolean {
  return id.startsWith(STARTER_DECK_ID_PREFIX);
}

const JINSHI_SAN_YANG = `
# Jinshi-San-Ro

# Characters: Jinshi, Sanhua, Rover (F)
BP01-029x1
BP01-028x1
BP01-030x1
SD02-005x1
SD02-006x1
BP01-031x1
BP01-032x1
BP01-033x1
SD02-003x1
SD02-004x1
BP01-016x1
BP01-017x1
BP01-018x1
SD01-001x1
SD01-002x1

# Action Deck (40)
BP01-073x3
BP01-074x3
BP01-075x3
BP01-076x3
SD01-020x3
SD01-021x3
SD02-007x3
SD02-008x3
SD02-009x3
SD02-010x3
SD02-011x3
SD02-012x1
SD02-013x3
SD02-014x3
`;

const ENCORE_YANG_ROF = `
# Encore-Yang-RoF

# Characters: Encore, Yangyang, Rover (F)
BP01-011x1
BP01-012x1
BP01-013x1
BP01-014x1
BP01-015x1
BP01-022x1
BP01-023x1
BP01-024x1
SD01-003x1
SD01-004x1
BP01-016x1
BP01-017x1
BP01-018x1
SD01-001x1
SD01-002x1

# Action Deck (40)
BP01-059x3
BP01-060x3
BP01-061x2
BP01-062x3
BP01-063x3
BP01-064x3
BP01-069x3
BP01-070x1
SD01-012x2
SD01-014x3
SD01-015x3
SD01-020x3
SD01-021x3
SD01-022x3
SD01-023x2
`;

const CAMELL_SAN_SHORE = `
# Camell-san-shore

# Characters: Shorekeeper, Camellya, Sanhua
BP01-010x1
BP01-006x1
BP01-007x1
BP01-008x1
BP01-009x1
BP01-001x1
BP01-002x1
BP01-003x1
BP01-004x1
BP01-005x1
BP01-031x1
BP01-032x1
BP01-033x1
SD02-003x1
SD02-004x1

# Action Deck (40)
BP01-046x3
BP01-048x3
BP01-049x3
BP01-050x2
BP01-053x3
BP01-054x3
BP01-057x3
BP01-058x3
BP01-076x3
SD02-012x3
SD02-013x3
SD02-014x3
SD02-015x3
SD02-016x2
`;

/**
 * The source text, with the id each one is published under.
 *
 * Ids are written out rather than derived from the name: they are what the
 * lobby remembers as "the deck I played last", so renaming a deck must not
 * silently orphan that.
 */
const SOURCES: { id: string; text: string }[] = [
  { id: `${STARTER_DECK_ID_PREFIX}jinshi-san-yang`, text: JINSHI_SAN_YANG },
  { id: `${STARTER_DECK_ID_PREFIX}encore-yang-rof`, text: ENCORE_YANG_ROF },
  { id: `${STARTER_DECK_ID_PREFIX}camell-san-shore`, text: CAMELL_SAN_SHORE },
];

/**
 * The built-in decks, parsed once.
 *
 * A fresh object every call: a DeckList is mutable data and the builder edits
 * one in place, so handing out a shared reference would let a player's
 * unsaved edits leak into the built-in deck for the rest of the session.
 */
export function starterDecks(): DeckList[] {
  return SOURCES.map(({ id, text }) => parseDeck(text, id, id).deck);
}

/** Anything the parser could not read, for the test that keeps these honest. */
export function starterDeckParseErrors(): { id: string; errors: string[] }[] {
  return SOURCES.map(({ id, text }) => ({ id, errors: parseDeck(text, id, id).errors })).filter(
    (entry) => entry.errors.length > 0
  );
}
