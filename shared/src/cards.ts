// Card *database* schema — the shape of a card as printed.
//
// This is deliberately separate from the runtime types in game.ts:
//   cards.ts  = the card as printed (static, one row per physical card)
//   game.ts   = the card as it exists in a match (instance, has an owner,
//               a position, a zone, counters on it...)
//
// Card data itself lives in src/data/*.json and is validated against this
// schema by cardDb.ts. Keywords are a CLOSED set — adding a new one means
// adding it to CARD_KEYWORDS below (and to cards.schema.json), which is the
// point: a typo in a data file becomes a build error instead of a silent
// no-op at the table.

import type { CardColor, CharacterLevel } from "./game";

// --- i18n --------------------------------------------------------------

export type Lang = "en" | "th";

/**
 * Text available in more than one language. Every field is optional so a
 * language can be filled in gradually — English first, Thai added later, or
 * vice versa. See localize() for how a missing language is resolved.
 *
 * Currently only used for the `notes` field (see CardDefBase below). Card
 * name, character and effect text are still plain strings.
 */
export interface LocalizedText {
  en?: string;
  th?: string;
}

/**
 * Reads one language out of a LocalizedText, falling back to whichever
 * language IS filled in when the requested one is missing, so a
 * half-translated entry still shows something instead of a blank.
 */
export function localize(text: LocalizedText | undefined, lang: Lang = "en"): string {
  if (!text) return "";
  return text[lang] ?? text.en ?? text.th ?? "";
}

// --- Keywords --------------------------------------------------------------

/**
 * Every keyword that can tag an effect. Closed set — a card may combine
 * several on one effect line (e.g. Enter + Follow, Battle + Advantage).
 */
export const CARD_KEYWORDS = [
  /** Passive ability, live only while this leader is the active one. */
  "leader",
  /** Fires when another card is leveled up on top of this one. */
  "levelUp",
  /** Fires when this card is put onto the field. */
  "enter",
  /** Fires when the battle result is judged. */
  "judgement",
  /** Fires on entering the Battle Phase. */
  "battle",
  /** Fires at the start of this player's own Counter Phase. */
  "counterPhaseStart",
  /** Fires at the end of the Counter Phase. */
  "counterPhaseEnd",
  /** Fires at the start of this player's own turn. */
  "turnStart",
  /** [Counter] — applies when this card is played in the Counter Phase. */
  "counter",
  /** Fires when characters are switched and this card is involved. */
  "switch",
  /** Fires at end of turn. */
  "endTurn",
  /**
   * Follow{x}: this card GRANTS x follow-up attacks when it wins. The other
   * half of the pair is "combo", below.
   */
  "follow",
  /**
   * Fires when this card is played AS a follow-up (playing into a follow-up
   * is called a combo). The opposite side of "follow": follow grants the
   * chain, combo reacts to being part of one.
   */
  "combo",
  /** Conditional on having won the most recent battle. */
  "advantage",
  /**
   * Always on. No trigger and no condition — the effect is simply true for
   * as long as the card is in play. Untagged "this card just does X" effects
   * belong here.
   */
  "passive",
] as const;

export type CardKeyword = (typeof CARD_KEYWORDS)[number];

// The keywords are not all the same kind of thing, and splitting them is what
// lets the engine handle each correctly:
//
//   TRIGGER    — happens AT A MOMENT. The engine raises it, the effect runs
//                once, the result sticks. Enter, Judgement, End turn...
//   CONTINUOUS — always true while the card is in play. Never "runs" as an
//                event; it is re-derived from the board whenever anything
//                changes, so it can never double-apply or go stale.
//                `passive` is unconditional; `leader` is the same thing
//                restricted to the leader who is currently active.
//   CONDITION  — WHETHER an effect applies (Advantage). Checked inside the
//                behaviour via ctx.wonLastBattle().
//   MODIFIER   — changes the battle rather than running as a step (Follow{x}).

export const TRIGGER_KEYWORDS = [
  "levelUp",
  "enter",
  "judgement",
  "battle",
  "counterPhaseStart",
  "counterPhaseEnd",
  "turnStart",
  "counter",
  "switch",
  "endTurn",
  "combo",
] as const;
export type EffectTrigger = (typeof TRIGGER_KEYWORDS)[number];

export const CONTINUOUS_KEYWORDS = ["leader", "passive"] as const;
export type ContinuousKeyword = (typeof CONTINUOUS_KEYWORDS)[number];

export const CONDITION_KEYWORDS = ["advantage"] as const;
export const MODIFIER_KEYWORDS = ["follow"] as const;

/** Every keyword a behaviour module can supply a function for. */
export type BehaviorKey = EffectTrigger | ContinuousKeyword;

export function isTrigger(keyword: CardKeyword): keyword is EffectTrigger {
  return (TRIGGER_KEYWORDS as readonly string[]).includes(keyword);
}

export function isContinuous(keyword: CardKeyword): keyword is ContinuousKeyword {
  return (CONTINUOUS_KEYWORDS as readonly string[]).includes(keyword);
}

/** Display strings for the UI (Detail panel, battle log). */
export const KEYWORD_LABEL: Record<CardKeyword, { en: string; th: string }> = {
  leader: { en: "Leader", th: "ลีดเดอร์" },
  levelUp: { en: "Level Up", th: "เลเวลอัป" },
  enter: { en: "Enter", th: "ลงสนาม" },
  judgement: { en: "Judgement", th: "ตัดสิน" },
  // Raised by the engine when the Battle Step opens; no printed card carries
  // it. Named apart from `counter` above so no two keywords ever show a
  // player the same word.
  battle: { en: "Battle Step", th: "ช่วงประลอง" },
  counterPhaseStart: {
    en: "At start of own Battle phase",
    th: "เมื่อเริ่มเฟสประลองของตัวเอง",
  },
  counterPhaseEnd: { en: "At end of Battle phase", th: "เมื่อจบเฟสประลอง" },
  turnStart: { en: "At start of own turn", th: "เมื่อเริ่มเทิร์นของตัวเอง" },
  // The game's own word for this clash is Battle — ประลอง — so that is what
  // a player sees, even though the engine and the cards' printed text both
  // still say Counter. PRINTED_TAG_KEYWORD is what maps the printed word to
  // this keyword; nothing reads these labels back.
  counter: { en: "Battle", th: "ประลอง" },
  switch: { en: "Switch", th: "สลับตัว" },
  endTurn: { en: "End Turn", th: "จบเทิร์น" },
  follow: { en: "Follow", th: "ฟอลโลว์" },
  advantage: { en: "Advantage", th: "แอดวานเทจ" },
  combo: { en: "Combo", th: "คอมโบ" },
  passive: { en: "Passive", th: "ทำงานตลอดเวลา" },
};

/**
 * Bracket tags as printed on the cards, mapped to our keyword union.
 *
 * The printed wording is not one-to-one with ours: the same trigger is
 * written several ways across sets ("at end of turn", "at end of own turn",
 * "at end of each turn"), and [Leader Skill] is a scope note rather than a
 * trigger of its own. Keys are lowercased, so look up through
 * keywordForTag() rather than indexing this directly.
 *
 * Two things read it: the importer, turning printed text into conditions,
 * and the UI, deciding which run of text is a keyword worth colouring.
 */
export const PRINTED_TAG_KEYWORD: Record<string, CardKeyword> = {
  leader: "leader",
  "leader skill": "leader",
  judgement: "judgement",
  combo: "combo",
  counter: "counter",
  "level up": "levelUp",
  enter: "enter",
  advantage: "advantage",
  switch: "switch",
  battle: "battle",
  "follow-up attack": "follow",
  "at end of each turn": "endTurn",
  "at end of own turn": "endTurn",
  "at end of turn": "endTurn",
  "at start of own turn": "turnStart",
  "at start of own counter phase": "counterPhaseStart",
  "at end of counter phase": "counterPhaseEnd",
  "at end of each counter phase": "counterPhaseEnd",
};

/**
 * The keyword a bracket tag names, whichever language it is written in and
 * however it was capitalised, or null if it names nothing we know.
 *
 * Both spellings have to resolve: the printed text carries the English tags
 * the cards are actually printed with, while formatEffect writes the same
 * keywords out in the reader's own language.
 */
export function keywordForTag(raw: string): CardKeyword | null {
  // "[Follow{8}]" — the count belongs to the effect, not to the name.
  const text = raw.replace(/\{[^}]*\}/g, "").trim();
  const key = text.toLowerCase();
  const printed = PRINTED_TAG_KEYWORD[key];
  if (printed) return printed;
  for (const keyword of CARD_KEYWORDS) {
    const label = KEYWORD_LABEL[keyword];
    if (label.en.toLowerCase() === key || label.th === text) return keyword;
  }
  return null;
}

/**
 * The colour each keyword is printed in on wuwatcgdb, the card database this
 * app's card text is imported from — read off its `card_options` table so a
 * player who learned the tags there reads the same three groups here:
 * orange for when an effect fires, purple for when it applies at all, blue
 * for the follow-up chain.
 *
 * `battle` and `passive` are ours rather than theirs — nothing is printed on
 * a card for either — so they take the colour of the group they belong to.
 */
export const KEYWORD_COLOR: Record<CardKeyword, string> = {
  levelUp: "#ff8648",
  enter: "#ff8648",
  judgement: "#ff8648",
  battle: "#ff8648",
  counterPhaseStart: "#ff8648",
  counterPhaseEnd: "#ff8648",
  turnStart: "#ff8648",
  counter: "#ff8648",
  switch: "#ff8648",
  endTurn: "#ff8648",
  combo: "#ff8648",
  leader: "#864ffe",
  advantage: "#864ffe",
  passive: "#864ffe",
  follow: "#3a87fe",
};

/** Keywords that carry a numeric value — currently only Follow{x}. */
export const VALUED_KEYWORDS: readonly CardKeyword[] = ["follow"];

export function isCardKeyword(value: unknown): value is CardKeyword {
  return typeof value === "string" && (CARD_KEYWORDS as readonly string[]).includes(value);
}

// --- Effects ---------------------------------------------------------------

// --- What a card DOES ------------------------------------------------------
//
// The card database holds what is PRINTED on a card: name, cost, colour,
// stats, art, and the effect text. It deliberately does not describe how an
// effect works, because card designers keep inventing mechanics and any
// data format for behaviour is permanently one card behind.
//
// Behaviour lives in code instead, one module per card under src/behaviors,
// keyed by card number. See cardBehavior.ts. A card with no behaviour module
// still works: the engine hands its printed text to the players to apply.

/**
 * Which cards a modifier applies to. Every field is optional and they AND
 * together, so `{ color: "red" }` is "all red cards" and
 * `{ color: "red", character: "Jiyan" }` is "Jiyan's red cards".
 * An empty filter means every card the controller owns.
 */
export interface CardFilter {
  /**
   * Cards carrying this keyword, e.g. every card with a [Leader] ability.
   * Some abilities single those out — "Chixia's [Leader skill] cards get +3".
   */
  keyword?: CardKeyword | CardKeyword[];
  color?: CardColor | CardColor[];
  character?: string | string[];
  cardId?: string | string[];
  /**
   * Printed card category, e.g. "Normal Attack" or "Echo". A card matches
   * when it carries ANY of the listed subtypes.
   */
  subtype?: string | string[];
  /** Whose cards: the effect's controller, the opponent, or both. */
  side?: "self" | "opponent" | "both";
}

/**
 * How long a stat modifier lasts.
 *  battle      — until the current battle is judged
 *  turn        — until end of turn
 *  whileActive — as long as the card that granted it is still in play
 *                (leader passives)
 *  permanent   — for the rest of the match
 */
export type ModifierDuration =
  | "battle"
  | "turn"
  | "whileActive"
  | "permanent"
  /**
   * Starts applying on the NEXT turn and lasts that turn — "next round your
   * opponent's red cards cost 1 more". Surviving one end-of-turn sweep turns
   * it into an ordinary "turn" modifier, which the following sweep clears.
   */
  | "nextTurn";

/**
 * The printed numbers an effect can change. "damageTaken" is the odd one
 * out: it belongs to a player rather than a card, so its filter is ignored
 * and `controllerId` names whose damage it changes.
 */
export type ModifiableStat = "attack" | "speed" | "damageTaken" | "cost";

/** One live stat change on the board, created by a modifyStat op. */
export interface StatModifier {
  /** Unique per modifier, so it can be removed individually. */
  id: string;
  controllerId: string;
  /** The card that granted it — used to expire "whileActive" modifiers. */
  sourceCardId: string;
  stat: ModifiableStat;
  /**
   * "add" bumps the printed value; "set" replaces it outright, for abilities
   * that read "this card's Speed becomes 10". Defaults to "add".
   */
  mode?: "add" | "set";
  /**
   * Applies to only the first N matching cards its controller plays in a
   * turn — "each round, the FIRST {Normal attack} gets +2". Without it the
   * modifier hits every matching card. Which cards qualify is worked out from
   * the turn log; see qualifyingModifiers() in effects.ts.
   */
  limit?: number;
  amount: number;
  filter: CardFilter;
  duration: ModifierDuration;
  /**
   * True when a continuous effect produced this. Derived modifiers are
   * thrown away and rebuilt on every recompute, which is what keeps an
   * always-on effect from stacking with itself.
   */
  derived?: boolean;
}

/** The parts of a card a filter looks at. Both card shapes can supply these. */
export interface FilterableCard {
  /** Keywords printed anywhere on the card, for `filter.keyword`. */
  keywords?: CardKeyword[];
  id: string;
  color: CardColor;
  character?: string | null;
  subtypes?: string[];
}

function asList<T>(value: T | T[] | undefined): T[] | undefined {
  if (value === undefined) return undefined;
  return Array.isArray(value) ? value : [value];
}

/**
 * Does this modifier apply to this card? All present fields must match.
 * `side` is checked by the caller, which knows who owns the card.
 */
export function matchesFilter(card: FilterableCard, filter: CardFilter): boolean {
  const colors = asList(filter.color);
  if (colors && !colors.includes(card.color)) return false;

  const characters = asList(filter.character);
  if (characters && (!card.character || !characters.includes(card.character))) return false;

  const ids = asList(filter.cardId);
  if (ids && !ids.includes(card.id)) return false;

  // The printed data spells these inconsistently ("Basic attack" vs
  // "Basic Attack"), so compare without case.
  const subtypes = asList(filter.subtype)?.map((s) => s.toLowerCase());
  const own = card.subtypes?.map((s) => s.toLowerCase()) ?? [];
  if (subtypes && !subtypes.some((s) => own.includes(s))) return false;

  if (filter.keyword !== undefined) {
    const wanted = Array.isArray(filter.keyword) ? filter.keyword : [filter.keyword];
    const has = card.keywords ?? [];
    if (!wanted.some((keyword) => has.includes(keyword))) return false;
  }

  return true;
}

/** Plain-language rendering of a filter, for the battle log. */
export function describeFilter(filter: CardFilter): string {
  const parts: string[] = [];
  for (const value of [
    asList(filter.color),
    asList(filter.character),
    asList(filter.subtype),
    asList(filter.cardId),
  ]) {
    if (value) parts.push(value.join("/"));
  }
  if (filter.side && filter.side !== "self") parts.push(`(${filter.side})`);
  return parts.length > 0 ? `${parts.join(" ")} cards` : "all own cards";
}

/**
 * A card's stats after every applicable modifier. Combat must use this —
 * the printed values are only the starting point.
 */
export function effectiveStats(
  card: FilterableCard & { attack: number; speed: number; cost?: number },
  ownerId: string,
  modifiers: StatModifier[]
): { attack: number; speed: number; cost: number } {
  const value = { attack: card.attack, speed: card.speed, cost: card.cost ?? 0 };

  // "set" wins over "add" regardless of the order they were applied in, so a
  // card whose Speed "becomes 10" is 10 even with a +2 sitting on it.
  const setters: Partial<Record<ModifiableStat, number>> = {};

  for (const modifier of modifiers) {
    if (modifier.stat === "damageTaken") continue; // a player stat, not a card's
    if (!appliesTo(modifier, card, ownerId)) continue;

    if (modifier.mode === "set") setters[modifier.stat] = modifier.amount;
    else value[modifier.stat] += modifier.amount;
  }

  for (const [stat, amount] of Object.entries(setters)) {
    value[stat as Exclude<ModifiableStat, "damageTaken">] = amount;
  }

  return {
    attack: Math.max(0, value.attack),
    speed: Math.max(0, value.speed),
    cost: Math.max(0, value.cost),
  };
}

/** Whether a modifier reaches a particular card on a particular side. */
export function appliesTo(
  modifier: StatModifier,
  card: FilterableCard,
  ownerId: string
): boolean {
  const side = modifier.filter.side ?? "self";
  const ownedByController = ownerId === modifier.controllerId;
  if (side === "self" && !ownedByController) return false;
  if (side === "opponent" && ownedByController) return false;
  return matchesFilter(card, modifier.filter);
}

/**
 * Strips a parallel-art suffix off an image filename to get the card number:
 * "BP01-005_2PR" -> "BP01-005". Cards are keyed by this, so every parallel
 * printing resolves back to the one row holding the real card data.
 */
export function baseCardId(imageId: string): string {
  return imageId.split("_")[0];
}
/**
 * A card may be leveled up onto a character as long as the incoming level is
 * >= the character's current level, so 0→1→1→2→2 and 0→1→2 are both legal.
 * Level 0 is a starting card only — it is never played on top of anything.
 */
export function canLevelUp(currentLevel: CharacterLevel, incomingLevel: CharacterLevel): boolean {
  return incomingLevel >= 1 && incomingLevel >= currentLevel;
}

/**
 * Thai glosses for the printed card categories.
 *
 * The English name is what card text refers to — "{Heavy Attack} ของคุณ..." —
 * so the UI shows it alongside the gloss rather than replacing it. A category
 * with no entry here (the Echo set names: Sierra Gale, Molten Rift...) is a
 * proper noun and shows as printed.
 */
export const SUBTYPE_LABEL_TH: Record<string, string> = {
  "Normal Attack": "โจมตีปกติ",
  "Basic Attack": "โจมตีพื้นฐาน",
  "Heavy Attack": "โจมตีหนัก",
  "Mid-air Attack": "โจมตีกลางอากาศ",
  "Resonance Skill": "สกิลเรโซแนนซ์",
  "Resonance Liberation": "ปลดปล่อยเรโซแนนซ์",
  "Intro Skill": "สกิลเปิดตัว",
  "Outro Skill": "สกิลปิดตัว",
  "Leader Skill": "สกิลลีดเดอร์",
  "Forte Circuit": "โฟร์เต้เซอร์กิต",
  Echo: "เอคโค่",
  Dodge: "หลบ",
  "Dodge Counter": "สวนกลับหลังหลบ",
  Airborn: "ลอยตัว",
  Movement: "เคลื่อนที่",
  Utilities: "อเนกประสงค์",
};

/** "โจมตีหนัก (Heavy Attack)", or just the printed name when there is no gloss. */
export function subtypeLabel(subtype: string): string {
  const gloss = SUBTYPE_LABEL_TH[subtype];
  return gloss ? `${gloss} (${subtype})` : subtype;
}
