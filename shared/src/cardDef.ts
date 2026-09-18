// A card, whole: what is printed on it AND what it does, in one place.
//
// These used to be two things — a JSON row for the printed data and a
// separate behaviour module for the code. Nothing tied them together, so the
// text could say one thing while the code did another and no one would know.
//
// Now one effect entry carries all three parts of a printed ability:
//
//   condition — WHEN it applies. A trigger keyword, plus any extra checks.
//   text      — what the card says, for the player to read.
//   resolve   — what actually happens. Omit it and the engine asks the
//               players to apply the text by hand.
//
//   {
//     condition: ["levelUp"],
//     text: "นำการ์ดใบนี้กลับเข้า Character deck",
//     resolve: (ctx) => ctx.returnToCharacterDeck(),
//   }
//
// Because resolve is a plain function, a card can do anything the language
// can express. Nothing has to be added to a data format first.

import type {
  CardFilter,
  CardKeyword,
  ContinuousKeyword,
  EffectTrigger,
  Lang,
  LocalizedText,
  ModifierDuration,
} from "./cards";
import type { CardColor, CharacterLevel } from "./game";
import { KEYWORD_COLOR, KEYWORD_LABEL, isContinuous, isTrigger, keywordForTag, localize } from "./cards";
import type { ActionCard, MatchState, PlayerBoard } from "./game";

// --- What an effect can see and do -----------------------------------------

/**
 * The toolbox handed to a condition or a resolve function. Everything a card
 * reads or changes goes through here, so the engine can log every change and
 * roll the whole lot back if something throws half-way.
 */
export interface EffectContext {
  /** The card whose effect is running. */
  readonly self: CardDef;
  readonly controllerId: string;
  readonly opponentId: string;
  /** Full read access. Prefer the helpers below for anything they cover. */
  readonly state: MatchState;

  // --- queries ---
  /** Did the controller win the most recent battle? ([Advantage]) */
  wonLastBattle(): boolean;
  /**
   * Did the controller win the last battle with a card of this colour?
   * Printed all over the place as "if you won with a green card".
   */
  wonWith(color: CardColor): boolean;
  /** Did the controller LOSE the last battle to a card of this colour? */
  lostTo(color: CardColor): boolean;
  /**
   * The colour this player revealed in the last battle — what abilities mean
   * by "while playing a green card" or "if you countered with blue".
   */
  lastPlayedColor(playerId?: string): CardColor | null;
  board(playerId?: string): PlayerBoard;
  hand(playerId?: string): ActionCard[];
  life(playerId?: string): number;
  /** The active leader's card number, or null if that slot is empty. */
  leaderId(playerId?: string): string | null;
  /** Cards revealed in the Action area this battle. */
  actionZone(playerId?: string): ActionCard[];
  /** Cards sitting in the Concerto / Charge area. */
  concerto(playerId?: string): ActionCard[];
  /** How many cards in a zone match a filter — "2 or more {Normal Attack}". */
  countMatching(cards: ActionCard[], filter: CardFilter): number;

  // --- what has happened this turn ---
  /** Cards this player has played this turn, oldest first. */
  cardsPlayedThisTurn(playerId?: string): ActionCard[];
  /** How many cards matching a filter this player has played this turn. */
  countPlayedThisTurn(filter: CardFilter, playerId?: string): number;
  /** Has THIS card been played this turn? */
  selfPlayedThisTurn(playerId?: string): boolean;
  /** Life this player has lost this turn. */
  damageTakenThisTurn(playerId?: string): number;
  /** Life this player has recovered this turn. */
  healedThisTurn(playerId?: string): number;
  /**
   * For "N times per round": returns true and books a use when the ability
   * still has one left, false once it is spent. Pass a label when one card
   * has more than one limited ability.
   */
  useLimit(max: number, label?: string): boolean;
  /** Impose a turn-scoped restriction, e.g. "noCombo". */
  restrict(flag: string, playerId?: string): void;
  /** Is a restriction in force for this player this turn? */
  isRestricted(flag: string, playerId?: string): boolean;

  // --- actions ---
  draw(count: number, playerId?: string): void;
  damage(amount: number, targetId?: string): void;
  heal(amount: number, playerId?: string): void;
  discard(count: number, playerId?: string): void;
  /** Move cards from hand into the Energy/Competition area. */
  charge(count: number, playerId?: string): void;
  /** Put this card back into the Character Deck (the open character pool). */
  returnToCharacterDeck(): void;
  /** Swap the active leader with one of the back characters. */
  switchLeader(toCardId?: string, playerId?: string): void;
  /**
   * Reveal the top cards of the deck. They stay on top; the caller decides
   * what happens next, which is usually a player choice.
   */
  revealTop(count: number, playerId?: string): ActionCard[];
  /** Move the top card of the deck into the Concerto/Charge area. */
  topToConcerto(count: number, playerId?: string): void;
  /** Move the top cards of the deck straight into hand. */
  deckToHand(count: number, playerId?: string): ActionCard[];
  /** Move the top cards of the deck straight to the trash. */
  deckToTrash(count: number, playerId?: string): ActionCard[];
  /**
   * Move cards from the trash back to hand. Without a filter it takes the
   * most recently trashed; with one it takes the newest match.
   */
  trashToHand(count: number, filter?: CardFilter, playerId?: string): void;
  /**
   * Continuous stat change. The filter decides which cards it hits:
   *   ctx.buff({ color: "red", character: "Camellya" }, "attack", +1)
   */
  buff(
    filter: CardFilter,
    stat: "attack" | "speed" | "cost",
    amount: number,
    duration?: ModifierDuration,
    options?: BuffOptions
  ): void;
  /**
   * Replace a printed number outright — "this card's Speed becomes 10" —
   * rather than adding to it. Wins over any +/- on the same stat.
   */
  setStat(
    filter: CardFilter,
    stat: "attack" | "speed" | "cost",
    value: number,
    duration?: ModifierDuration,
    options?: BuffOptions
  ): void;
  /**
   * Change how much damage a player takes. Positive means they take more.
   *
   * `limit` counts HITS rather than cards: `{ limit: 1 }` is "each round,
   * damage taken -1" — it softens the first hit of the turn and is spent,
   * however many follow-ups land after it.
   */
  modifyDamageTaken(
    amount: number,
    playerId?: string,
    duration?: ModifierDuration,
    options?: { limit?: number }
  ): void;

  // --- handing abilities to other cards ---
  /**
   * Give matching cards an ability they were not printed with. The ability
   * is declared once in the granting card's `grants`, and handed out by name:
   *
   *   grants: {
   *     comboBoost: {
   *       condition: ["combo"],
   *       text: { th: "การ์ดใบนี้ได้รับ +1 ดาเมจ" },
   *       resolve: (c) => c.buff({ cardId: c.self.id }, "attack", 1, "battle"),
   *     },
   *   },
   *   ...
   *   resolve: (ctx) => ctx.grantEffect({ color: "red" }, "comboBoost")
   *
   * Inside the granted ability, `ctx.self` is the card that RECEIVED it.
   */
  grantEffect(
    filter: CardFilter,
    grantKey: string,
    duration?: ModifierDuration,
    options?: BuffOptions
  ): void;

  // --- the Action Area ---
  /** Cap how many matching cards may sit in a player's Action Area. */
  limitActionArea(filter: CardFilter, max: number, playerId?: string): void;
  /** Grant follow-up attacks to a player who won the clash. */
  grantFollowUp(count: number, playerId?: string): void;
  /** Move this card out of the Action Area and back to its owner's hand. */
  returnToHand(): void;

  // --- characters ---
  /**
   * Level a character up from an effect rather than as the turn's action.
   *
   * The player picks which card to use when more than one is legal, and the
   * usual pair of triggers fires — [Enter] on the card arriving, [Level up]
   * on the one it covers — so an ability that levels a character up is worth
   * exactly what levelling them up by hand would have been. Returns false
   * when there is nothing in the pool to play.
   *
   * `level` is for a card that names the level it puts into play, rather than
   * telling the character to climb: "put an 「Encore」 Level 2 card on top of
   * your 「Encore」" (BP01-062). Only cards of exactly that level are offered,
   * and the one-step ladder does not apply — naming the level IS the point of
   * such a card. Without it the ordinary ladder rules, same as the Action
   * Phase move.
   */
  levelUpCharacter(
    characterName: string,
    options?: { level?: CharacterLevel; playerId?: string }
  ): boolean;
  /** Switch the Leader to the named character, if they are in the back. */
  switchLeaderTo(characterName: string, playerId?: string): boolean;

  // --- moving cards about ---
  /** Move cards from the trash into the Concerto area. */
  trashToConcerto(count: number, filter?: CardFilter, playerId?: string): void;
  /** Bin cards out of a player's Concerto area. */
  concertoToTrash(count: number, filter?: CardFilter, playerId?: string): void;
  /** Put cards underneath the Action Deck, oldest first. */
  toDeckBottom(cards: ActionCard[], playerId?: string): void;
  /** Spend cards from the Concerto area. Returns false if they cannot pay. */
  spendCost(amount: number, playerId?: string): boolean;
  /** Search the deck for matching cards, take them to hand, then shuffle. */
  searchDeck(filter: CardFilter, count: number, playerId?: string): ActionCard[];
  /** Shuffle a player's Action Deck, using the match's own seed. */
  shuffleDeck(playerId?: string): void;
  /** A card taken at random from a hand — the engine's only randomness. */
  randomFromHand(playerId?: string): ActionCard | null;
  /** Turn a player's hand face-up to both players for the rest of the turn. */
  revealHand(playerId?: string): void;

  /** Is it this player's turn? Defaults to the card's controller. */
  isTurnPlayer(playerId?: string): boolean;
  /**
   * Is this player the defending side — the one whose turn it is NOT?
   *
   * The Counter Phase belongs to the defender, so an ability printed "at the
   * start of your OWN Counter phase" only applies while you are defending.
   * One printed "each Counter phase" applies to both sides and should not use
   * this.
   */
  isDefender(playerId?: string): boolean;

  /** The character name of a player's active Leader — "if your Leader is Encore". */
  leaderName(playerId?: string): string | null;
  /** Discard these specific cards out of a hand. */
  discardCards(cards: ActionCard[], playerId?: string): void;

  // --- restrictions ---
  /** Impose a restriction that starts applying on the NEXT turn. */
  restrictNextTurn(flag: string, playerId?: string): void;

  /** Add a line to the battle log. */
  log(message: string): void;

  // --- asking the player ---
  //
  // Each of these either returns the answer already given, or stops the
  // effect so the engine can go and ask. Call them in a stable order: the
  // answers are matched up by the order they were asked in.

  /** "You MAY do this" — returns what the player said. */
  confirm(prompt: LocalizedText, playerId?: string): boolean;
  /**
   * Pick one card out of `from`. Returns null when the player is allowed to
   * decline and does, so always handle null.
   */
  chooseCard(
    prompt: LocalizedText,
    from: ActionCard[],
    options?: { optional?: boolean; playerId?: string }
  ): ActionCard | null;
  /** Pick several cards at once. */
  chooseCards(
    prompt: LocalizedText,
    from: ActionCard[],
    options?: { min?: number; max?: number; playerId?: string }
  ): ActionCard[];
  /** Pick one of a fixed list of choices, e.g. which character to switch to. */
  chooseOption(prompt: LocalizedText, options: ChoiceOption[], playerId?: string): string;
}

// --- Asking the player -----------------------------------------------------
//
// Plenty of abilities say "สามารถ..." — you MAY do this, or: pick one of
// these. That needs an answer from a person, which cannot happen inside a
// synchronous function.
//
// So a choice is a stop, not a wait. The effect runs until it needs an
// answer, the engine rewinds everything it did and reports the question, and
// when the answer comes back the effect runs again from the top with that
// answer already on hand. Resolution therefore stays a pure function of
// (state, trigger, sources, answers): same inputs, same outcome, every time.

export type ChoiceKind = "confirm" | "pickCard" | "pickOption";

/** One option the player can pick, for pickCard / pickOption. */
export interface ChoiceOption {
  /**
   * What comes back as the answer. Unique within one question — a trash pile
   * holds several copies of the same printed card, and two options that read
   * the same are two options the player cannot tell apart or pick between.
   */
  value: string;
  label: LocalizedText;
  /**
   * Which card this option shows, when the option IS a card. Separate from
   * `value` precisely because several options can be the same card; this is
   * what the art and the Detail panel are looked up by.
   */
  cardId?: string;
}

/** A question the engine is waiting on before an effect can finish. */
export interface PendingChoice {
  kind: ChoiceKind;
  /** Who has to answer. */
  playerId: string;
  /** The card that is asking. */
  cardId: string;
  prompt: LocalizedText;
  options: ChoiceOption[];
  /** For pickCard: how many to pick. Both default to 1. */
  min: number;
  max: number;
}

/** What a player sent back: yes/no, one value, or several. */
export type ChoiceAnswer = boolean | string | string[];

// --- Conditions ------------------------------------------------------------

/** A check the engine runs itself, beyond what a keyword already says. */
export type ConditionFn = (ctx: EffectContext) => boolean;

/**
 * One entry in an effect's `condition` list. Every entry must hold for the
 * effect to apply, so the list reads as an AND.
 *
 *   ["levelUp"]                          — whenever this card is levelled up
 *   ["judgement", "advantage"]           — on judgement, if you won last battle
 *   ["enter", (ctx) => ctx.life() < 10]  — on entering, if you are under 10 Life
 */
export type Condition = CardKeyword | ConditionFn;

/** Extra knobs shared by buff, setStat and grantEffect. */
export interface BuffOptions {
  /**
   * Only the first N matching cards the controller plays this turn get it —
   * "each round, the FIRST {Normal attack} gets +2".
   */
  limit?: number;
  /** Whose cards it reaches. Defaults to the controller's own. */
  side?: CardFilter["side"];
}

/** The first trigger keyword in a condition list — for labelling an effect. */
export function triggerOf(condition: Condition[]): EffectTrigger | null {
  return triggersOf(condition)[0] ?? null;
}

/**
 * EVERY trigger keyword in a condition list.
 *
 * Plenty of cards are printed with two — "[Enter] / [Level up]" on a Level 1
 * character, "[Counter] / [Combo]" on an action card. They mean "on either of
 * these", so matching only the first would quietly kill half the ability.
 */
export function triggersOf(condition: Condition[]): EffectTrigger[] {
  return condition.filter(
    (entry): entry is EffectTrigger => typeof entry !== "function" && isTrigger(entry)
  );
}

/**
 * The continuous keyword in a condition list, if this is an always-on effect.
 *
 * An effect that ALSO names a trigger is not always-on, whatever else it
 * carries: "[Leader] [Counter] deal 1 damage" happens once, at the Counter
 * Phase, and `leader` there only says whose — it gates the effect to the
 * active Leader rather than making it continuous. Treating it as continuous
 * hands it to recomputeContinuous, which re-runs every continuous effect from
 * scratch whenever anything on the board moves; a one-shot in that list fires
 * again on every level up, charge and switch for the rest of the game.
 */
export function continuousOf(condition: Condition[]): ContinuousKeyword | null {
  if (triggersOf(condition).length > 0) return null;
  for (const entry of condition) {
    if (typeof entry !== "function" && isContinuous(entry)) return entry;
  }
  return null;
}

/** Every keyword in a condition list, ignoring the function checks. */
export function keywordsOf(condition: Condition[]): CardKeyword[] {
  return condition.filter((entry): entry is CardKeyword => typeof entry !== "function");
}

// --- Effects ---------------------------------------------------------------

export interface CardEffect {
  /** When this applies. Keywords and custom checks, all ANDed together. */
  condition: Condition[];
  /**
   * The ability as printed, for the player to read. Fill one language and
   * add the other later — a missing language falls back to whichever is
   * there, so a half-translated card still shows something.
   */
  text: LocalizedText;
  /** The x in Follow{x}. Required iff the condition includes "follow". */
  followCount?: number;
  /**
   * What happens. Leave it out while the effect is not implemented — the
   * engine will surface the text and let the players apply it themselves
   * rather than silently doing nothing.
   */
  resolve?: (ctx: EffectContext) => void;
  /** Your own labels for grouping and searching. Open set. */
  tags?: string[];
}

/** True when nobody has written the code for this effect yet. */
export function isManual(effect: CardEffect): boolean {
  return typeof effect.resolve !== "function";
}

/**
 * The keyword tags an effect leads with, written the way a card prints them:
 * "[Enter][Follow{2}]".
 *
 * Each tag keeps the keyword it came from. Reading it back out of the text
 * afterwards would work only for as long as no two keywords ever share a
 * display name, and that is not a promise the labels make.
 */
function effectTags(
  effect: CardEffect,
  lang: Lang
): { text: string; keyword: CardKeyword }[] {
  return keywordsOf(effect.condition).map((keyword) => {
    const label = KEYWORD_LABEL[keyword][lang];
    const text =
      keyword === "follow" && effect.followCount !== undefined
        ? `[${label}{${effect.followCount}}]`
        : `[${label}]`;
    return { text, keyword };
  });
}

/**
 * Drops the keyword tags the imported text opens with.
 *
 * The printed text carries its own "[Enter] / [Level up]" prefix and the
 * engine writes the same keywords out from the effect's conditions, so
 * showing both reads "[ลงสนาม][เลเวลอัป] [Enter] / [Level up] ...". Only the
 * opening run goes: a tag further in is part of the sentence — "+8
 * [follow-up attack]", or a tag inside an ability being quoted — and means
 * something the conditions do not say.
 */
function withoutLeadingTags(body: string): string {
  let at = 0;
  for (;;) {
    const rest = body.slice(at);
    // "[Enter] / [Level up]" — the slash joins a pair rather than starting
    // the sentence, so it is skipped along with the tag it follows.
    const match = /^\s*\/?\s*\[([^\]\n]+)\]/.exec(rest);
    if (!match || !keywordForTag(match[1])) break;
    at += match[0].length;
  }
  return at === 0 ? body : body.slice(at).trimStart();
}

/**
 * The printed ability in one language, with the keyword tags in front the
 * way the card shows them: "[Enter][Follow{2}] draw two cards".
 */
export function formatEffect(effect: CardEffect, lang: Lang = "en"): string {
  const tags = effectTags(effect, lang)
    .map((tag) => tag.text)
    .join("");
  const body = withoutLeadingTags(localize(effect.text, lang));
  return body ? `${tags} ${body}` : tags;
}

/**
 * One run of an ability's text: either plain wording, or a keyword tag with
 * the colour it is printed in.
 */
export interface EffectSegment {
  text: string;
  keyword?: CardKeyword;
  color?: string;
}

/**
 * formatEffect, split so a keyword can be drawn as the coloured tag it is
 * rather than as bracketed prose.
 *
 * Every bracket is looked at, not just the ones in front: an ability that
 * quotes another ability, or that names 〈follow-up attack〉 mid-sentence,
 * has keywords in the middle of it and they are the same keywords. A bracket
 * naming nothing we know stays exactly as printed — unrecognised is not the
 * same as absent, and silently dropping it would hide a card we have not
 * finished importing.
 */
export function effectSegments(effect: CardEffect, lang: Lang = "en"): EffectSegment[] {
  const segments: EffectSegment[] = [];
  const push = (text: string, keyword?: CardKeyword | null) => {
    if (!text) return;
    if (keyword) segments.push({ text, keyword, color: KEYWORD_COLOR[keyword] });
    else segments.push({ text });
  };

  for (const tag of effectTags(effect, lang)) {
    push(tag.text, tag.keyword);
  }

  const body = withoutLeadingTags(localize(effect.text, lang));
  if (!body) return segments;
  if (segments.length > 0) push(" ");

  let at = 0;
  for (const match of body.matchAll(/\[([^\]\n]+)\]/g)) {
    const keyword = keywordForTag(match[1]);
    if (!keyword) continue;
    push(body.slice(at, match.index));
    push(match[0], keyword);
    at = match.index + match[0].length;
  }
  push(body.slice(at));
  return segments;
}

// --- Card definitions ------------------------------------------------------

/** WuWa elements, as printed on a character card. */
export type Element = "aero" | "glacio" | "fusion" | "electro" | "havoc" | "spectro";

/** WuWa weapon types, as printed on a character card. */
export type Weapon = "sword" | "broadblade" | "pistols" | "gauntlets" | "rectifier";

interface CardDefBase {
  /** Printed card number — unique across the whole database. e.g. "BP01-001" */
  id: string;
  /** Card title as printed. */
  name: string;
  /**
   * The character this card belongs to. For a character card this is itself;
   * for an action card it is the character it is tied to. null for a neutral
   * action card any deck may run.
   */
  character: string | null;
  /** Set code, e.g. "BP01". */
  set: string;
  /** Filename under client/public/cards (no extension). Usually === id. */
  imageId: string;
  /**
   * Parallel / alternate-art printings (the `_2`, `_4`, `_PR`... files).
   * Same card, different picture — never a separate row.
   */
  altImageIds?: string[];
  /** Printed star rating. */
  rarity?: number;
  effects: CardEffect[];
  /**
   * Abilities this card can hand to OTHER cards, keyed by a name it passes to
   * ctx.grantEffect. Declared here rather than inline so that what ends up in
   * the match state is just the key — see GrantedEffect.
   */
  grants?: Record<string, CardEffect>;
  /**
   * Notes for whoever is filling this in. Never rendered in game, so leave it
   * in whichever language is convenient.
   */
  notes?: LocalizedText;
}

/**
 * A character card. The game UI calls these Character cards; the rules text
 * calls the active one the Leader, which is why the keyword is "leader".
 */
export interface LeaderCardDef extends CardDefBase {
  type: "leader";
  /** 0, 1 or 2. Level up must go to a level >= the current one. */
  level: CharacterLevel;
  element?: Element;
  weapon?: Weapon;
}

export interface ActionCardDef extends CardDefBase {
  type: "action";
  /** Paid from the Energy/Competition area. */
  cost: number;
  /** Decides the battle result: red > green > blue > red. */
  color: CardColor;
  /**
   * null on blue cards, which print no Speed at all: blue always draws
   * against blue, and any other colour is decided by colour alone, so Speed
   * is never consulted for them.
   */
  speed: number | null;
  attack: number;
  /**
   * Printed card categories such as "Leader Skill", "Intro Skill",
   * "Normal Attack" — other cards refer to these by name in their text.
   */
  subtypes?: string[];
}

export type CardDef = LeaderCardDef | ActionCardDef;

/**
 * Declares one card. Purely a typing helper — it returns what you give it,
 * but pins the shape so the editor autocompletes keywords, ctx methods and
 * every field, and a mistake is a build error rather than a silent no-op.
 */
export function defineCard(card: CardDef): CardDef {
  return card;
}

export function isLeaderCard(card: CardDef): card is LeaderCardDef {
  return card.type === "leader";
}

export function isActionCard(card: CardDef): card is ActionCardDef {
  return card.type === "action";
}

// --- Card-level queries ----------------------------------------------------

export function hasKeyword(card: CardDef, keyword: CardKeyword): boolean {
  return card.effects.some((effect) => keywordsOf(effect.condition).includes(keyword));
}

/** Effects that fire on a given trigger. */
export function effectsForTrigger(card: CardDef, trigger: EffectTrigger): CardEffect[] {
  return card.effects.filter((effect) => triggersOf(effect.condition).includes(trigger));
}

/** Always-on effects of a given kind ("passive" or "leader"). */
export function effectsForContinuous(card: CardDef, kind: ContinuousKeyword): CardEffect[] {
  return card.effects.filter((effect) => continuousOf(effect.condition) === kind);
}

/** Effects carrying one of your own free-form tags. */
export function effectsWithTag(card: CardDef, tag: string): CardEffect[] {
  return card.effects.filter((effect) => effect.tags?.includes(tag));
}

/** Every image available for a card: the main art first, then its parallels. */
export function allImageIds(card: CardDef): string[] {
  return [card.imageId, ...(card.altImageIds ?? [])];
}

/** Every custom tag used anywhere in a card list — handy for auditing. */
export function collectTags(cards: CardDef[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const card of cards) {
    for (const effect of card.effects) {
      for (const tag of effect.tags ?? []) {
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
    }
  }
  return counts;
}

/**
 * How many follow-up attacks this card grants when it wins, from its
 * Follow{x}. null when it has no Follow, which means it grants no combo.
 */
export function followCountOf(card: CardDef): number | null {
  for (const effect of card.effects) {
    if (keywordsOf(effect.condition).includes("follow") && typeof effect.followCount === "number") {
      return effect.followCount;
    }
  }
  return null;
}

/**
 * The combo a winning card grants. Winning with a RED card allows unlimited
 * follow-ups; any other colour grants only what its own Follow{x} says, and
 * nothing at all without one.
 */
export function comboGrantFor(card: CardDef): { unlimited: boolean; count: number } {
  if (card.type === "action" && card.color === "red") {
    return { unlimited: true, count: Infinity };
  }
  return { unlimited: false, count: followCountOf(card) ?? 0 };
}
