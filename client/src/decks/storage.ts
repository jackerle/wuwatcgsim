// Saved decks, kept in this browser — plus the built-in ones that are not.
//
// There are no accounts, so there is nowhere else to put a player's own decks.
// localStorage survives refreshes and is what the lobby reads when it asks
// which deck you are bringing. Everything here is defensive: a private window,
// blocked site data, or a half-written entry from an older build must cost a
// deck at worst, never a crash on load.
//
// The starter decks (shared/src/starterDecks.ts) are deliberately NOT written
// into storage on first run. Seeding them would make them a player's own decks
// — editable, deletable, and frozen at whatever the build shipped that day —
// and a player who cleared one would never see it again. Read from code, they
// are simply always there, and a new set ships with a new build.

import { emptyDeck, isStarterDeckId, starterDecks, type DeckList } from "@wuwatcg/shared";

const KEY = "wuwatcg.decks";

function read(): DeckList[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Anything that doesn't have the shape is dropped rather than trusted —
    // a deck saved by an older build is not worth crashing the list over.
    return parsed.filter((deck): deck is DeckList => {
      if (!deck || typeof deck !== "object") return false;
      const d = deck as Partial<DeckList>;
      return (
        typeof d.id === "string" &&
        typeof d.name === "string" &&
        Array.isArray(d.characters) &&
        !!d.cards &&
        typeof d.cards === "object"
      );
    });
  } catch {
    return [];
  }
}

function write(decks: DeckList[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(decks));
  } catch {
    // Out of quota or blocked. The deck stays usable for this session; the
    // alternative is losing the edit the player just made.
  }
}

/** Only the decks this player built. The builder and storage own these. */
export function loadDecks(): DeckList[] {
  return read();
}

/**
 * Every deck a player can pick or look at: their own first, then the built-in
 * ones.
 *
 * Their own come first because a returning player is looking for their deck,
 * not ours. A stored deck carrying a starter id is dropped rather than shown
 * twice — that can only come from a build where these were seeded into
 * storage, and two rows with one id is a duplicate React key as well as a
 * confusing list.
 */
export function allDecks(): DeckList[] {
  return [...read().filter((deck) => !isStarterDeckId(deck.id)), ...starterDecks()];
}

export function saveDeck(deck: DeckList): DeckList[] {
  const decks = read();
  const at = decks.findIndex((d) => d.id === deck.id);
  if (at >= 0) decks[at] = deck;
  else decks.push(deck);
  write(decks);
  return decks;
}

export function deleteDeck(id: string): DeckList[] {
  const decks = read().filter((deck) => deck.id !== id);
  write(decks);
  return decks;
}

export function newDeckId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `deck-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function createDeck(name = "เด็คใหม่"): DeckList {
  return emptyDeck(newDeckId(), name);
}

/** The deck last taken into a match, so the lobby can preselect it. */
const LAST_KEY = "wuwatcg.lastDeck";

export function rememberedDeckId(): string | null {
  try {
    return localStorage.getItem(LAST_KEY);
  } catch {
    return null;
  }
}

export function rememberDeckId(id: string): void {
  try {
    localStorage.setItem(LAST_KEY, id);
  } catch {
    // Best effort — losing it only costs one extra click next time.
  }
}

/**
 * The deck last handed to the bot, kept apart from the player's own so the two
 * preselections do not clobber each other between matches.
 */
const LAST_BOT_KEY = "wuwatcg.lastBotDeck";

export function rememberedBotDeckId(): string | null {
  try {
    return localStorage.getItem(LAST_BOT_KEY);
  } catch {
    return null;
  }
}

export function rememberBotDeckId(id: string): void {
  try {
    localStorage.setItem(LAST_BOT_KEY, id);
  } catch {
    // Best effort — losing it only costs one extra click next time.
  }
}

/**
 * A deck as this browser keeps it: the deck itself, plus the one thing that
 * is only about how it looks here — the cards on its cover.
 *
 * Kept out of DeckList (shared) on purpose: a cover changes nothing about the
 * deck, is not part of a share code, and the server never needs to hear of
 * it. It rides along in the same saved object, so it is saved, duplicated and
 * deleted with the deck for free.
 */
export type SavedDeck = DeckList & {
  /** Up to three character card ids, in the order shown. */
  cover?: string[];
};
