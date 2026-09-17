// Lookups over every card in every set, plus the runtime checks TypeScript
// cannot make on its own.
//
// Most mistakes are now build errors: the card shape is a type, keywords are
// a union, and ctx methods are checked at the call site. What is left for
// this file is the rules-level stuff a type cannot see — a red card carrying
// a Speed on a blue card, a Follow with no count, two cards sharing a number.

import { localize } from "./cards";
import {
  isManual,
  keywordsOf,
  triggerOf,
  type CardDef,
  type CardEffect,
} from "./cardDef";
import { ALL_SETS } from "./sets";

export interface ValidationIssue {
  cardId: string;
  field: string;
  message: string;
}

// --- Validation ------------------------------------------------------------

/**
 * A stub created by sync-card-stubs but not filled in yet. Expected, not an
 * error — validateCard skips them so the sets can be filled a few cards at a
 * time without the validator turning red.
 */
export function isUnfilled(card: CardDef): boolean {
  return card.name === "";
}

function checkEffect(effect: CardEffect, cardId: string, index: number): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const where = `effects[${index}]`;
  const keywords = keywordsOf(effect.condition);

  if (!localize(effect.text)) {
    // Text is what a human reads when no resolve is written, so an effect
    // without it can never be applied at the table.
    issues.push({ cardId, field: `${where}.text`, message: "effect needs printed text" });
  }

  const usesFollow = keywords.includes("follow");
  if (usesFollow && typeof effect.followCount !== "number") {
    issues.push({
      cardId,
      field: `${where}.followCount`,
      message: "Follow{x} needs a numeric followCount",
    });
  }
  if (!usesFollow && effect.followCount !== undefined) {
    issues.push({
      cardId,
      field: `${where}.followCount`,
      message: "followCount set but the condition has no 'follow' keyword",
    });
  }

  // An effect the engine can never reach: no trigger, not continuous, and
  // not a pure battle modifier like Follow.
  const hasTrigger = triggerOf(effect.condition) !== null;
  const isContinuousEffect = keywords.includes("passive") || keywords.includes("leader");
  const isBattleModifier = usesFollow;
  if (!hasTrigger && !isContinuousEffect && !isBattleModifier && effect.resolve) {
    issues.push({
      cardId,
      field: `${where}.condition`,
      message: "has a resolve but no trigger or passive keyword — it would never run",
    });
  }

  return issues;
}

/** Validates one card. Returns [] when it is well-formed. */
export function validateCard(card: CardDef): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (isUnfilled(card)) return issues;

  const cardId = card.id;
  for (const field of ["id", "set", "imageId"] as const) {
    if (!card[field]) issues.push({ cardId, field, message: `${field} is required` });
  }

  card.effects.forEach((effect, i) => issues.push(...checkEffect(effect, cardId, i)));

  if (card.type === "action") {
    // Blue prints no Speed: blue always draws against blue, and every other
    // match-up is settled by colour, so Speed never comes into it.
    if (card.color === "blue" && card.speed !== null) {
      issues.push({ cardId, field: "speed", message: "blue cards print no Speed — use null" });
    }
    if (card.color !== "blue" && typeof card.speed !== "number") {
      issues.push({ cardId, field: "speed", message: `${card.color} cards need a Speed` });
    }
  }

  return issues;
}

/** Validates a whole set, including cross-card checks. */
export function validateSet(cards: CardDef[]): ValidationIssue[] {
  const issues = cards.flatMap(validateCard);
  const seen = new Set<string>();
  for (const card of cards) {
    if (seen.has(card.id)) {
      issues.push({ cardId: card.id, field: "id", message: "duplicate card id in this set" });
    }
    seen.add(card.id);
  }
  return issues;
}

// --- Lookups ---------------------------------------------------------------

export const ALL_CARDS: CardDef[] = Object.values(ALL_SETS).flat();

const CARD_INDEX = new Map(ALL_CARDS.map((card) => [card.id, card]));

/** Look up a printed card by its card number. */
export function getCard(id: string): CardDef | undefined {
  return CARD_INDEX.get(id);
}

/** Look up a card, throwing if missing — for places where absence is a bug. */
export function requireCard(id: string): CardDef {
  const card = CARD_INDEX.get(id);
  if (!card) throw new Error(`Unknown card id: ${id}`);
  return card;
}

/** All cards belonging to one character, e.g. every level of one leader. */
export function cardsForCharacter(character: string): CardDef[] {
  return ALL_CARDS.filter((card) => card.character === character);
}

/** Cards with at least one effect nobody has written the code for yet. */
export function cardsNeedingResolve(): CardDef[] {
  return ALL_CARDS.filter((card) => !isUnfilled(card) && card.effects.some(isManual));
}

export { ALL_SETS };
