// Saved decks, kept in this browser.
//
// There are no accounts, so there is nowhere else to put them. localStorage
// survives refreshes and is what the lobby reads when it asks which deck you
// are bringing. Everything here is defensive: a private window, blocked site
// data, or a half-written entry from an older build must cost a deck at
// worst, never a crash on load.

import { emptyDeck, type DeckList } from "@wuwatcg/shared";

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

export function loadDecks(): DeckList[] {
  return read();
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
