// Core data shapes for the WuWa TCG rules. Card *content* (names, skill
// text, exact stat values) will come from a card database later — these
// types describe the shape that data has to fit, plus the runtime state
// of a match in progress.

import {
  effectiveStats,
  type CardFilter,
  type FilterableCard,
  type ModifierDuration,
  type StatModifier,
} from "./cards";

export type CardColor = "red" | "green" | "blue";

/**
 * Levels run 0, 1, 2 — two is the ceiling. A card may be levelled up onto a
 * character at its current level or higher, so 0>1>1>2>2 and 0>1>2 are both
 * legal ladders. See canLevelUpOnto() in rules.ts.
 */
export type CharacterLevel = 0 | 1 | 2;

export const MAX_CHARACTER_LEVEL = 2;

/** A character card as printed — one specific level of one character. */
export interface CharacterCard {
  id: string; // e.g. "BP01-001"
  name: string; // shared across all levels of the same character
  level: CharacterLevel;
  imageId: string; // filename in client/public/cards, without extension
}

/** An action card as printed. */
export interface ActionCard {
  id: string;
  name: string;
  color: CardColor;
  cost: number; // top-left value, paid from the Competition Area
  damage: number;
  speed: number;
  imageId: string;
}

/**
 * The id every card a player is not allowed to see is given.
 *
 * Hidden cards are replaced rather than removed, so counts survive the trip:
 * how many cards the opponent holds, how many are left in their deck and
 * whether they have committed one face-down are all public information, and
 * all of it would vanish if the arrays were simply emptied.
 */
export const HIDDEN_CARD_ID = "hidden";

/** A stand-in for a card the viewer may not see. Carries no real values. */
export function hiddenActionCard(index: number): ActionCard {
  return {
    // Unique within its zone: React keys a hand by id and position, and a
    // list of identical ids would make two backs look like one card.
    id: `${HIDDEN_CARD_ID}-${index}`,
    name: "",
    color: "red",
    cost: 0,
    damage: 0,
    speed: 0,
    imageId: "",
  };
}

/** A face-down character, for a starter the opponent may not see yet. */
export function hiddenCharacterCard(index: number): CharacterCard {
  return { id: `${HIDDEN_CARD_ID}-char-${index}`, name: "", level: 0, imageId: "" };
}

/** Is this one of the placeholders viewFor() puts in place of a hidden card? */
export function isHiddenCard(card: { id: string }): boolean {
  return card.id.startsWith(`${HIDDEN_CARD_ID}-`);
}

/** What happened in the most recent battle, for abilities that ask. */
export interface BattleRecord {
  winnerId: string | null;
  loserId: string | null;
  /** The colour each side revealed, keyed by playerId. */
  colorByPlayer: Record<string, CardColor>;
  /** The card each side revealed, keyed by playerId. */
  cardIdByPlayer: Record<string, string>;
}

/**
 * What has happened so far this turn. Plenty of abilities ask about it —
 * "if the opponent took damage this turn", "the first {Normal Attack} each
 * round", "twice per round" — and none of it can be read off the board once
 * the moment has passed, so it is recorded as it happens.
 *
 * Cleared at the start of each turn by resetTurnLog().
 */
export interface TurnLog {
  /** Cards each player has played this turn, oldest first. */
  cardsPlayed: Record<string, ActionCard[]>;
  /**
   * Character cards each player put into play this turn, by card number.
   *
   * Separate from cardsPlayed because a character is not an action card and
   * the filters that read cardsPlayed — colour, cost, subtype — have nothing
   * to say about one. Kept because "if this card was not played this round"
   * is printed on characters too (BP01-011), and without this the answer was
   * always no: a character reaches the field by being levelled up, which
   * never touched cardsPlayed.
   */
  charactersPlayed: Record<string, string[]>;
  /** Life each player has lost this turn. */
  damageTaken: Record<string, number>;
  /**
   * How many separate times damage has landed on each player this turn.
   *
   * Not the same question as how much: "each round, damage taken -1"
   * (BP01-002) reduces one hit, and with an unlimited red chain the
   * difference between one hit and eight is the whole card.
   */
  hitsTaken: Record<string, number>;
  /** Life each player has recovered this turn. */
  healed: Record<string, number>;
  /**
   * How many times a limited ability has fired this turn, keyed by the card
   * (plus a label when one card has several limits). Drives "N times per
   * round" via ctx.useLimit().
   */
  uses: Record<string, number>;
  /**
   * Turn-scoped restrictions a card has imposed, keyed by playerId — e.g.
   * "noCombo", "noLeaderSwitch".
   */
  flags: Record<string, string[]>;
  /**
   * The clash this turn was a draw. Nothing is left to do in a turn whose
   * clash drew — there is no Combo Step — so the client ends it on its own.
   */
  clashDrawn?: boolean;
}

/**
 * Cards an ability turned face-up for both players: the top of a deck, a card
 * taken to hand from a deck or the trash, a whole hand. Public information,
 * so viewFor() leaves these alone — this is how the opponent sees them.
 */
export interface RevealEntry {
  /** Whose cards they are. */
  playerId: string;
  /** The card whose ability showed them. */
  sourceCardId: string;
  /** Who controls that ability — not always `playerId` ("reveal your hand"). */
  controllerId?: string;
  /**
   *   revealTop    shown off the top of the deck
   *   toHand       taken from the deck to hand
   *   trashToHand  taken from the trash to hand
   *   search       found by searching the deck
   *   hand         a whole hand turned face-up
   */
  kind: "revealTop" | "toHand" | "trashToHand" | "search" | "hand";
  cards: ActionCard[];
  /** For a reveal: how many of those cards then went to hand. */
  taken?: number;
  /**
   * The phase the reveal is shown for. Unset while the step that made it is
   * still running; step() stamps it and drops the entry once the phase moves on.
   */
  phase?: TurnPhase;
}

export type CharacterPosition = "leader" | "back";

/**
 * A character currently in play, in a specific position.
 *
 * Levelling up does not replace the character, it builds on them: the new
 * card goes on top and the ones it was played over stay underneath. `card` is
 * always the top of that pile — the level the character is actually at —
 * and `under` holds the rest, lowest first.
 */
export interface CharacterInstance {
  position: CharacterPosition;
  card: CharacterCard;
  under: CharacterCard[];
}

/** The whole pile for a character in play, lowest level first. */
export function characterStack(slot: CharacterInstance): CharacterCard[] {
  return [...slot.under, slot.card];
}

/**
 * `leaderSelect` and `mulligan` are the two opening steps, before turn 1.
 * `leaderSelect` comes first: both players freely arrange their three Level 0
 * starters between the Leader slot and the two Back slots (rule 101.4 — "in
 * any order"). `mulligan` follows it: both players may put any number of
 * their five cards back, shuffle and draw that many again. Neither is part
 * of the turn cycle — see TURN_PHASE_ORDER — and a match never returns to
 * either one.
 */
export type TurnPhase = "leaderSelect" | "mulligan" | "draw" | "action" | "counter" | "combo" | "end";

/** The one non-draw action a player may take per turn (at most once each). */
export type ActionKind = "charge" | "levelUp" | "switch";

export interface PlayerBoard {
  playerId: string;
  life: number; // starts at 20
  leader: CharacterInstance | null;
  back: CharacterInstance[]; // up to 2
  characterPool: CharacterCard[]; // Character Deck cards not currently in play
  actionDeck: ActionCard[]; // face-down draw pile (order hidden from opponent)
  hand: ActionCard[];
  competitionArea: ActionCard[]; // charged cards, sideways, used to pay costs
  trash: ActionCard[];
  actionsTakenThisTurn: ActionKind[]; // tracks the once-each-per-turn limit
}

/**
 * The follow-up allowance the winner of a battle is currently holding.
 * Created by resolveCombat's ComboGrant and spent one card at a time during
 * the Combo Step; null once nobody may extend.
 */
export interface ComboWindow {
  playerId: string;
  unlimited: boolean;
  /** Follow-ups still available. Ignored while `unlimited`. */
  remaining: number;
}

export interface MatchState {
  matchId: string;
  turnNumber: number;
  turnPlayerId: string;
  /** Who took turn 1 — they draw one card instead of two on it. */
  startingPlayerId: string;
  phase: TurnPhase;
  boards: Record<string, PlayerBoard>; // keyed by playerId
  /**
   * The card each player has committed face-down for the Counter Phase,
   * before both are turned up. Hidden information: the server must strip the
   * opponent's entry before sending state to a client.
   */
  facedown: Record<string, ActionCard | null>;
  /**
   * Who has finished choosing for this Counter Phase. A player with nothing
   * playable — an empty hand, or no card they can pay for — declines instead,
   * which counts as choosing and leaves their `facedown` null.
   */
  committed: Record<string, boolean>;
  /**
   * Who has finished their opening mulligan. Both players decide at once, so
   * this is the same shape as `committed` — the phase ends when everyone is
   * in, whatever order they answered in.
   */
  mulliganDone: Record<string, boolean>;
  /**
   * Who has finished arranging their starting Leader, the step before the
   * mulligan. Same shape, same reason: both players choose independently and
   * the phase ends once everyone has.
   */
  leaderChosen: Record<string, boolean>;
  /**
   * Each player's Action Zone: starts with the one card revealed in the
   * Counter Phase, then grows as combo cards are added during the Combo
   * Step. Capped at ACTION_ZONE_MAX_CARDS.
   */
  actionZone: Record<string, ActionCard[]>;
  /** Who may still add follow-up cards this Combo Step, and how many. */
  combo: ComboWindow | null;
  /**
   * Who won the most recent battle. null before the first battle, or after one
   * that drew. This is the live result — a [Judgement] skill asking "if you
   * deal damage" reads it, because the winner is settled before Judgement
   * resolves. [Advantage] does NOT: see `advantageId`.
   */
  lastBattleWinnerId: string | null;
  /**
   * Who holds [Advantage] for the turn now being played.
   *
   * Winning a battle does not hand you Advantage in the same turn — you have
   * it from the NEXT turn onwards. So this is a snapshot taken when the turn
   * opened and left alone for the rest of it, rather than a live reading of
   * `lastBattleWinnerId`: this turn's clash overwrites that before [Judgement]
   * and the Combo Step run, and reading it would switch Advantage on mid-turn
   * for whoever just won.
   *
   * A LIST, because two things grant it and both can land at once: "you won the
   * previous clash, OR your opponent skipped the Battle Phase". If neither side
   * laid a card down, nobody won and each side's opponent skipped — so both
   * hold Advantage on the following turn.
   */
  advantageIds: string[];
  /**
   * Who will hold [Advantage] next turn, booked when the clash resolves.
   *
   * Kept apart from `advantageIds` for the same reason `pendingFlags` is kept
   * apart from `turnLog.flags`: the thing is decided this turn and starts
   * applying on the next one, and the two must never be read as one.
   */
  pendingAdvantageIds: string[];
  /**
   * The detail of that battle, which a lot of printed abilities ask about:
   * "if you won with a green card", "if you lost to a red card". null on a
   * draw or before the first battle.
   */
  lastBattle: BattleRecord | null;
  /**
   * Continuous stat changes granted by effects. Each one carries its own
   * filter (which cards it hits) and duration (when it goes away), so
   * "red cards get +2 attack this turn" is one entry here. Combat reads
   * these on top of the card's printed values — see effectiveStats().
   */
  statModifiers: StatModifier[];
  /** Everything that has happened this turn — see TurnLog. */
  turnLog: TurnLog;
  /**
   * Abilities handed to cards that were not printed with them: "your red
   * cards gain [Combo] this card gets +1 damage". Kept out of the CardDef,
   * which is immutable printed data, and folded in when a trigger is raised.
   */
  grantedEffects: GrantedEffect[];
  /**
   * Caps on how many cards of a kind may sit in a player's Action Area, e.g.
   * "〈Echo〉 may be on the Action Area up to 1". Rebuilt from the board like
   * any other continuous effect.
   */
  zoneLimits: ZoneLimit[];
  /** Players whose hand is currently face-up to everyone. */
  revealedHands: string[];
  /** Cards an ability is showing both players right now — see RevealEntry. */
  reveals: RevealEntry[];
  /**
   * Restrictions that start applying NEXT turn — "next round your opponent
   * cannot use follow-up attacks". resetTurnLog moves these into the log.
   */
  pendingFlags: Record<string, string[]>;
  /**
   * Counter behind every random choice the rules call for. The engine has no
   * other source of randomness on purpose: a step is replayed from the top
   * each time a player answers a question, and Math.random would give a
   * different answer on the replay and corrupt the whole run.
   */
  rngSeed: number;
  winnerId: string | null;
}

/** An ability granted to cards matching a filter, rather than printed on them. */
export interface GrantedEffect {
  id: string;
  controllerId: string;
  sourceCardId: string;
  /** Which cards receive it. */
  filter: CardFilter;
  /**
   * Which of the granting card's `grants` to hand out.
   *
   * A key rather than the ability itself: MatchState is structuredClone'd on
   * every step and sent over a socket, and a CardEffect holds a `resolve`
   * function, which neither of those can carry.
   */
  effectKey: string;
  duration: ModifierDuration;
  /** Only the first N matching cards played this turn receive it. */
  limit?: number;
  /** Produced by a continuous effect; rebuilt on every recompute. */
  derived?: boolean;
}

/** A cap on how many matching cards may occupy a player's Action Area. */
export interface ZoneLimit {
  id: string;
  controllerId: string;
  sourceCardId: string;
  filter: CardFilter;
  max: number;
  derived?: boolean;
}

/**
 * Advances the seed and returns a whole number below `bound`.
 *
 * Deterministic on purpose: the same state always produces the same draw, so
 * replaying a step after a player answers a question reaches the same result.
 * Mutates `state.rngSeed`, so it must only be called from inside an effect
 * that the engine can roll back.
 */
export function nextRandom(state: MatchState, bound: number): number {
  if (bound <= 0) return 0;
  // xorshift32 — tiny, and good enough to pick a card at random.
  let seed = state.rngSeed >>> 0 || 0x9e3779b9;
  seed ^= seed << 13;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  state.rngSeed = seed >>> 0;
  return state.rngSeed % bound;
}

/** Fisher-Yates using the match's own seed, so a shuffle stays replayable. */
export function shuffleWithState<T>(state: MatchState, cards: T[]): T[] {
  const out = [...cards];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = nextRandom(state, i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * A complete MatchState with nothing in it.
 *
 * Every caller that builds a state by hand — the engine's own setup, and
 * every test fixture — starts here and overrides what it cares about, so
 * adding a field to MatchState does not break all of them at once.
 */
export function emptyMatchState(matchId: string, playerIds: string[]): MatchState {
  const byPlayer = <T,>(value: () => T): Record<string, T> =>
    Object.fromEntries(playerIds.map((id) => [id, value()]));

  return {
    matchId,
    turnNumber: 1,
    turnPlayerId: playerIds[0] ?? "",
    startingPlayerId: playerIds[0] ?? "",
    phase: "draw",
    boards: {},
    facedown: byPlayer(() => null),
    committed: byPlayer(() => false),
    mulliganDone: byPlayer(() => false),
    leaderChosen: byPlayer(() => false),
    actionZone: byPlayer<ActionCard[]>(() => []),
    combo: null,
    lastBattleWinnerId: null,
    advantageIds: [],
    pendingAdvantageIds: [],
    lastBattle: null,
    statModifiers: [],
    turnLog: emptyTurnLog(),
    grantedEffects: [],
    zoneLimits: [],
    revealedHands: [],
    reveals: [],
    pendingFlags: {},
    rngSeed: 0x9e3779b9,
    winnerId: null,
  };
}

/** An empty turn log, for starting a match or a new turn. */
export function emptyTurnLog(): TurnLog {
  return {
    cardsPlayed: {},
    charactersPlayed: {},
    damageTaken: {},
    hitsTaken: {},
    healed: {},
    uses: {},
    flags: {},
  };
}

// --- Rules constants (confirmed) ------------------------------------------

export const STARTING_LIFE = 20;
export const HAND_LIMIT = 8;
export const INITIAL_HAND_SIZE = 5;
export const FIRST_TURN_DRAW_COUNT = 1;
export const NORMAL_TURN_DRAW_COUNT = 2;
/**
 * Cards you may move into the Concerto area per turn. Charging is the Action
 * Phase's one point of energy, so a cost 2 card takes two turns to afford.
 */
export const CHARGE_PER_TURN = 1;
export const MAX_BACK_CHARACTERS = 2;
/** Leader plus back characters — the three that start the game on the field. */
export const CHARACTERS_IN_PLAY = MAX_BACK_CHARACTERS + 1;
export const ACTION_ZONE_MAX_CARDS = 5;

/** Color beats: red > green > blue > red. */
const BEATS: Record<CardColor, CardColor> = {
  red: "green",
  green: "blue",
  blue: "red",
};

export interface CombatEntry {
  playerId: string;
  card: ActionCard;
}

export interface ComboGrant {
  unlimited: boolean; // true for a Red win (infinite combos)
  count: number; // Green/Blue: from the winning card's Follow{x}; ignored if unlimited
}

export interface CombatResult {
  /** null on a draw (only possible for a Blue vs. Blue match-up). */
  winnerId: string | null;
  loserId: string | null;
  damage: number;
  /** The combo the winner gets to extend with; null on a draw. */
  combo: ComboGrant | null;
  /**
   * How it was decided, for the battle log.
   *
   * Worth recording because the outcome is often invisible otherwise: a
   * Dodge card wins on colour with 0 attack, so the loser takes nothing and
   * the clash reads as if nothing happened — right up until a [Judgement]
   * skill fires off the win.
   */
  why: CombatReason | null;
}

/** Why one card beat the other. */
export type CombatReason =
  | { kind: "color"; winner: CardColor; loser: CardColor }
  | { kind: "speed"; winner: number; loser: number }
  /** Same colour, same Speed: the turn player takes it. */
  | { kind: "tie" }
  /** The other player laid nothing out, so this card simply lands. */
  | { kind: "unopposed" };

/**
 * A runtime card knows its colour but not its character or subtype, and
 * filters need those. Callers that have the card database should pass
 * `filterableFor` from effects.ts; without it, filters narrowed by character
 * or subtype simply will not match.
 */
export type FilterableLookup = (card: ActionCard) => FilterableCard;

const plainFilterable: FilterableLookup = (card) => ({ id: card.id, color: card.color });

/** A combat entry's colour plus its stats after modifiers are applied. */
function statsOf(entry: CombatEntry, modifiers: StatModifier[], lookup: FilterableLookup) {
  const stats = effectiveStats(
    { ...lookup(entry.card), attack: entry.card.damage, speed: entry.card.speed },
    entry.playerId,
    modifiers
  );
  return { color: entry.card.color, ...stats };
}

/**
 * Default combo rule when the caller supplies no lookup: red wins are
 * unlimited, everything else falls back to the card's printed chase value.
 *
 * The real rule reads the winner's Follow{x} keyword out of the card
 * database — pass `comboLookup` to resolveCombat to use it. See
 * comboGrantFor() in cards.ts.
 */
function comboFor(card: ActionCard): ComboGrant {
  // Without a card-database lookup all we can tell from a runtime card is its
  // colour. Red wins are unlimited; any other colour needs its Follow{x},
  // which only the printed card knows — see comboLookupFromDb.
  return card.color === "red"
    ? { unlimited: true, count: Infinity }
    : { unlimited: false, count: 0 };
}

/**
 * Resolves one Counter Phase clash between the two simultaneously-revealed
 * action cards. `turnPlayer` gets the tie-break advantage per the rules.
 *
 * - Different colors: red > green > blue > red.
 * - Same color, both Blue: always a draw (speed is not consulted).
 * - Same color otherwise: higher Speed wins; equal Speed -> turn player wins.
 */
export function resolveCombat(
  turnPlayer: CombatEntry,
  nonTurnPlayer: CombatEntry,
  /**
   * Live stat modifiers from card effects. Combat compares the MODIFIED
   * values, so "red cards get +2 attack" changes both who wins on Speed and
   * how much damage lands.
   */
  modifiers: StatModifier[] = [],
  /**
   * How to work out the winner's combo. Pass one backed by the card database
   * (see comboGrantFor) to apply the real rule: red wins are unlimited, other
   * colours grant follow-ups only from their own Follow{x} keyword.
   */
  comboLookup: (card: ActionCard) => ComboGrant = comboFor,
  /**
   * How to look a card's character and subtype up, for modifiers filtered by
   * either. Pass `filterableFor` from effects.ts to make those work.
   */
  filterable: FilterableLookup = plainFilterable
): CombatResult {
  const a = statsOf(turnPlayer, modifiers, filterable);
  const b = statsOf(nonTurnPlayer, modifiers, filterable);

  // Damage comes from the winner's MODIFIED attack, not the printed value.
  const outcome = (turnPlayerWins: boolean, why: CombatReason): CombatResult => {
    const winner = turnPlayerWins ? turnPlayer : nonTurnPlayer;
    const loser = turnPlayerWins ? nonTurnPlayer : turnPlayer;
    return {
      winnerId: winner.playerId,
      loserId: loser.playerId,
      damage: (turnPlayerWins ? a : b).attack,
      combo: comboLookup(winner.card),
      why,
    };
  };

  if (a.color !== b.color) {
    const turnPlayerWins = BEATS[a.color] === b.color;
    return outcome(turnPlayerWins, {
      kind: "color",
      winner: turnPlayerWins ? a.color : b.color,
      loser: turnPlayerWins ? b.color : a.color,
    });
  }

  if (a.color === "blue") {
    // Blue vs. Blue is always a draw, regardless of Speed.
    return { winnerId: null, loserId: null, damage: 0, combo: null, why: null };
  }

  if (a.speed !== b.speed) {
    const turnPlayerWins = a.speed > b.speed;
    return outcome(turnPlayerWins, {
      kind: "speed",
      winner: turnPlayerWins ? a.speed : b.speed,
      loser: turnPlayerWins ? b.speed : a.speed,
    });
  }
  return outcome(true, { kind: "tie" });
}
