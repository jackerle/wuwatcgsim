// A deck as a player builds it, rather than as the engine consumes it.
//
// The engine wants two flat arrays of runtime cards (see createMatch). A
// player wants three characters and a pile of "this card, four copies". This
// file is the translation between the two, plus everything the builder needs
// to know what is legal and why.
//
// Nothing here reaches into a match: a DeckList is pure data, safe to keep in
// localStorage, paste into a chat window, or hand to the server.

import { ALL_CARDS, getCard } from "./cardDb";
import type { ActionCardDef, CardDef } from "./cardDef";
import { cardsFor, toActionCard, toCharacterCard } from "./decks";
import { CHARACTERS_IN_PLAY, type ActionCard, type CharacterCard } from "./game";
import { ACTION_DECK_SIZE } from "./rules";
import type { Lang } from "./cards";

/**
 * How many copies of one printed card a deck may hold.
 *
 * Three characters bring 19-27 action cards between them, plus the 10
 * Echoes everyone can use — nowhere near 40 on their own, so a deck is
 * always built out of copies and this is what stops it being four cards
 * ten times over.
 */
export const MAX_COPIES_PER_CARD = 4;

/** Three characters, and how many copies of each action card. */
export interface DeckList {
  id: string;
  name: string;
  /** Character names, up to CHARACTERS_IN_PLAY of them. */
  characters: string[];
  /** Action card id -> copies. Ids not in the pool are simply not legal. */
  cards: Record<string, number>;
}

export function emptyDeck(id: string, name: string): DeckList {
  return { id, name, characters: [], cards: {} };
}

/**
 * The Echo cards, which belong to no character and so belong to everyone.
 * They are why a deck's pool is never just its own three characters.
 */
export function neutralActionCards(): ActionCardDef[] {
  return ALL_CARDS.filter((card): card is ActionCardDef => card.type === "action" && !card.character);
}

/** Every action card these characters may put in a deck, in printed order. */
export function cardPoolFor(characters: readonly string[]): ActionCardDef[] {
  const pool: ActionCardDef[] = [];
  for (const name of characters) {
    for (const card of cardsFor(name).actions) {
      if (card.type === "action") pool.push(card);
    }
  }
  pool.push(...neutralActionCards());
  return pool;
}

/**
 * The Character Deck these three bring.
 *
 * Not a choice: each character is printed with exactly five cards — one at
 * Level 0 to start on and two at each level above — and three characters
 * fill the Character Deck's 15 slots exactly. There is nothing to pick.
 */
export function characterCardsFor(characters: readonly string[]): CardDef[] {
  const out: CardDef[] = [];
  for (const name of characters) out.push(...cardsFor(name).characters);
  return out;
}

/** Total cards in the Action Deck, counting copies. */
export function deckSize(deck: DeckList): number {
  return Object.values(deck.cards).reduce((sum, copies) => sum + copies, 0);
}

/**
 * Why this deck cannot be played yet, in the order a builder should fix them.
 * An empty list means it is legal.
 *
 * `lang` defaults to Thai — the server calls this with no language to pick
 * (it has no player preference to hand, and this path is a rare fallback
 * since the client already filters to playable decks before submitting
 * one), and shared/scripts/test-decklist.ts asserts against the Thai
 * wording, so that default has to stay byte-for-byte what it always was.
 */
export function deckIssues(deck: DeckList, lang: Lang = "th"): string[] {
  const issues: string[] = [];
  const say = (th: string, en: string) => issues.push(lang === "en" ? en : th);

  if (deck.characters.length !== CHARACTERS_IN_PLAY) {
    say(
      `ต้องเลือกตัวละคร ${CHARACTERS_IN_PLAY} ตัว (เลือกแล้ว ${deck.characters.length})`,
      `Pick ${CHARACTERS_IN_PLAY} characters (you've picked ${deck.characters.length})`
    );
  }
  if (new Set(deck.characters).size !== deck.characters.length) {
    say("เลือกตัวละครซ้ำกัน", "The same character is picked more than once");
  }

  const size = deckSize(deck);
  if (size !== ACTION_DECK_SIZE) {
    say(
      `Action Deck ต้องมี ${ACTION_DECK_SIZE} ใบพอดี (ตอนนี้ ${size})`,
      `The Action Deck needs exactly ${ACTION_DECK_SIZE} cards (currently ${size})`
    );
  }

  const allowed = new Set(cardPoolFor(deck.characters).map((card) => card.id));
  for (const [id, copies] of Object.entries(deck.cards)) {
    if (copies <= 0) continue;
    if (!allowed.has(id)) {
      const card = getCard(id);
      say(
        `${card?.name ?? id} (${id}) ไม่ได้อยู่ในตัวละครที่เลือก`,
        `${card?.name ?? id} (${id}) isn't from the characters you picked`
      );
    }
    if (copies > MAX_COPIES_PER_CARD) {
      say(
        `${getCard(id)?.name ?? id} เกิน ${MAX_COPIES_PER_CARD} ใบ (มี ${copies})`,
        `${getCard(id)?.name ?? id} is over the ${MAX_COPIES_PER_CARD}-copy limit (you have ${copies})`
      );
    }
  }

  return issues;
}

export function isDeckPlayable(deck: DeckList): boolean {
  return deckIssues(deck).length === 0;
}

/**
 * Flattens a deck list into the two arrays createMatch takes.
 *
 * Throws on an illegal deck rather than quietly dealing a broken one — the
 * builder and the server both check with deckIssues first, so reaching here
 * with a bad deck is a bug, not a user mistake.
 */
export function deckToSetup(deck: DeckList): {
  characterDeck: CharacterCard[];
  actionDeck: ActionCard[];
} {
  const issues = deckIssues(deck);
  if (issues.length > 0) throw new Error(`${deck.name}: ${issues.join("; ")}`);

  const actionDeck: ActionCard[] = [];
  for (const [id, copies] of Object.entries(deck.cards)) {
    const card = getCard(id);
    if (!card || card.type !== "action") continue;
    for (let i = 0; i < copies; i += 1) actionDeck.push(toActionCard(card));
  }

  return {
    characterDeck: characterCardsFor(deck.characters).map(toCharacterCard),
    actionDeck,
  };
}

// --- Text format -----------------------------------------------------------
//
// One card per line, "BP01-001x1". Character cards are written out too even
// though they are implied by the roster: it makes an exported list complete
// on its own, so pasting one back in reproduces the deck without needing the
// character names carried separately.

/** A deck as shareable text. */
export function formatDeck(deck: DeckList): string {
  const lines: string[] = [`# ${deck.name}`];

  const characters = characterCardsFor(deck.characters);
  if (characters.length > 0) {
    lines.push("", `# Characters: ${deck.characters.join(", ")}`);
    for (const card of characters) lines.push(`${card.id}x1`);
  }

  const chosen = Object.entries(deck.cards)
    .filter(([, copies]) => copies > 0)
    .sort(([a], [b]) => a.localeCompare(b));
  if (chosen.length > 0) {
    lines.push("", `# Action Deck (${deckSize(deck)})`);
    for (const [id, copies] of chosen) lines.push(`${id}x${copies}`);
  }

  return lines.join("\n");
}

export interface ParsedDeck {
  deck: DeckList;
  /** Lines that meant nothing, so a typo is reported rather than dropped. */
  errors: string[];
}

// "BP01-001x1", "BP01-001 x 1", "BP01-001", "3x BP01-001", "2 BP01-001".
const CARD_ID = /[A-Za-z]{2,4}\d{2}-\d{3}/;
const TRAILING = new RegExp(`^(${CARD_ID.source})\\s*(?:[xX*]\\s*(\\d+)|\\s+(\\d+))?$`);
const LEADING = new RegExp(`^(\\d+)\\s*[xX*]?\\s+(${CARD_ID.source})$`);

/**
 * Reads a pasted deck list.
 *
 * Forgiving on purpose — a list copied out of a chat window or a spreadsheet
 * arrives with stray blank lines, "#" titles and different multiplier
 * spellings, and none of that is worth making someone hand-clean.
 */
export function parseDeck(text: string, id: string, fallbackName: string): ParsedDeck {
  const deck = emptyDeck(id, fallbackName);
  const errors: string[] = [];
  const characters: string[] = [];
  /** Characters named only by their action cards, as a fallback roster. */
  const impliedBy = new Map<string, number>();

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("#") || line.startsWith("//")) {
      // A "# My deck" title line names the deck, if it came first.
      const title = line.replace(/^(#|\/\/)+\s*/, "");
      if (title && deck.name === fallbackName && !/^characters:|^action deck/i.test(title)) {
        deck.name = title;
      }
      continue;
    }

    const trailing = TRAILING.exec(line);
    const leading = trailing ? null : LEADING.exec(line);
    const cardId = trailing?.[1] ?? leading?.[2];
    const copies = Number(trailing?.[2] ?? trailing?.[3] ?? leading?.[1] ?? 1);
    if (!cardId || !Number.isFinite(copies) || copies <= 0) {
      errors.push(`อ่านไม่ออก: "${line}"`);
      continue;
    }

    const card = getCard(cardId.toUpperCase());
    if (!card) {
      errors.push(`ไม่มีการ์ดรหัส ${cardId}`);
      continue;
    }

    if (card.type === "leader") {
      // Character cards are the roster, not deck entries — the five printed
      // for a character come as a set, so one line is enough to name them.
      if (card.character && !characters.includes(card.character)) characters.push(card.character);
      continue;
    }

    deck.cards[card.id] = (deck.cards[card.id] ?? 0) + copies;
    if (card.character) impliedBy.set(card.character, (impliedBy.get(card.character) ?? 0) + copies);
  }

  // A list with no character cards still says who it is for: its action cards
  // belong to somebody. The most-used characters fill the empty slots.
  const byUse = [...impliedBy.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name);
  for (const name of byUse) {
    if (characters.length >= CHARACTERS_IN_PLAY) break;
    if (!characters.includes(name)) characters.push(name);
  }
  deck.characters = characters.slice(0, CHARACTERS_IN_PLAY);

  return { deck, errors };
}
