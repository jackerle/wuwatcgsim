// Turn structure, deck legality and win conditions.
//
// game.ts holds the shapes and the combat maths; this file holds the rules
// that drive a turn forward. Everything here is a pure function over
// MatchState so the server can run it and the client can predict with it.

import type { ActionCard, CharacterLevel } from "./game";
import {
  emptyTurnLog,
  HAND_LIMIT,
  type ActionKind,
  type CharacterCard,
  type MatchState,
  type PlayerBoard,
  type TurnPhase,
} from "./game";

// --- Deck building ---------------------------------------------------------

export const CHARACTER_DECK_MIN = 3;
export const CHARACTER_DECK_MAX = 15;
export const ACTION_DECK_SIZE = 40;

export interface DeckIssue {
  deck: "character" | "action";
  message: string;
}

/** Checks a deck list before a match starts. */
export function validateDecks(
  characterDeck: readonly unknown[],
  actionDeck: readonly unknown[]
): DeckIssue[] {
  const issues: DeckIssue[] = [];
  if (characterDeck.length < CHARACTER_DECK_MIN || characterDeck.length > CHARACTER_DECK_MAX) {
    issues.push({
      deck: "character",
      message: `Character Deck must hold ${CHARACTER_DECK_MIN}-${CHARACTER_DECK_MAX} cards (has ${characterDeck.length})`,
    });
  }
  if (actionDeck.length !== ACTION_DECK_SIZE) {
    issues.push({
      deck: "action",
      message: `Action Deck must hold exactly ${ACTION_DECK_SIZE} cards (has ${actionDeck.length})`,
    });
  }
  return issues;
}

// --- Phases ----------------------------------------------------------------

/**
 * Turn order. "counter" is the phase the rules text calls the Reaction
 * Phase — both names refer to the step where the two players reveal their
 * face-down cards simultaneously.
 */
export const TURN_PHASE_ORDER: readonly TurnPhase[] = [
  "draw",
  "action",
  "counter",
  "combo",
  "end",
] as const;

export const PHASE_LABEL: Record<TurnPhase, { en: string; th: string }> = {
  draw: { en: "Draw Phase", th: "เฟสจั่ว" },
  action: { en: "Action Phase", th: "เฟสแอ็กชัน" },
  counter: { en: "Reaction Phase", th: "เฟสตอบโต้" },
  combo: { en: "Combo Step", th: "ขั้นคอมโบ" },
  end: { en: "End Phase", th: "เฟสจบเทิร์น" },
};

/** The phase after this one, or null at the end of the turn. */
export function nextPhase(phase: TurnPhase): TurnPhase | null {
  const index = TURN_PHASE_ORDER.indexOf(phase);
  return index < 0 || index === TURN_PHASE_ORDER.length - 1
    ? null
    : TURN_PHASE_ORDER[index + 1];
}

// --- Draw Phase ------------------------------------------------------------

/**
 * Cards drawn this turn. The player who goes first draws one on turn 1
 * instead of two; everyone draws two from then on.
 */
export function drawCount(turnNumber: number, isStartingPlayer: boolean): number {
  return turnNumber === 1 && isStartingPlayer ? 1 : 2;
}

// --- Action Phase ----------------------------------------------------------

export const ACTION_KINDS: readonly ActionKind[] = ["charge", "levelUp", "switch"] as const;

/**
 * Each kind of action may be used at most once per turn, and repeats are not
 * allowed, so the ceiling of three follows from there being three kinds —
 * Charge, Level Up and Switch, in any order. Derived rather than written out
 * so the two rules can never drift apart.
 */
export const MAX_ACTIONS_PER_TURN = ACTION_KINDS.length;

export interface RuleCheck {
  ok: boolean;
  reason?: string;
}

export function canTakeAction(board: PlayerBoard, kind: ActionKind): RuleCheck {
  if (board.actionsTakenThisTurn.length >= MAX_ACTIONS_PER_TURN) {
    return { ok: false, reason: `Already used ${MAX_ACTIONS_PER_TURN} actions this turn` };
  }
  if (board.actionsTakenThisTurn.includes(kind)) {
    return { ok: false, reason: `${kind} has already been used this turn` };
  }
  return { ok: true };
}

/**
 * Levelling up costs discarding cards equal to the level being moved to,
 * so reaching level 2 costs two cards.
 */
export function levelUpCost(targetLevel: CharacterLevel): number {
  return targetLevel;
}

/**
 * A card may be levelled up onto a character when it names the same
 * character and moves them at most ONE level up.
 *
 * So the ladder climbs a step at a time: 0>1>2, or 0>1>1>2>2 if you play a
 * card of the level they are already at. Jumping 0>2 is not allowed, and
 * neither is going back down. Level 0 is a starting card only and is never
 * played on top of anything.
 */
export function canLevelUpOnto(
  current: CharacterCard,
  incoming: CharacterCard,
  board: PlayerBoard
): RuleCheck {
  if (incoming.name !== current.name) {
    return { ok: false, reason: "Level Up must use a card naming the same character" };
  }
  if (incoming.level < 1) {
    return { ok: false, reason: "Level 0 cards are starting cards, not Level Up cards" };
  }
  if (incoming.level < current.level) {
    return { ok: false, reason: `Cannot level down (${current.level} -> ${incoming.level})` };
  }
  if (incoming.level > current.level + 1) {
    return {
      ok: false,
      reason: `Level Up moves one level at a time (${current.level} -> ${incoming.level})`,
    };
  }
  const cost = levelUpCost(incoming.level);
  if (board.hand.length < cost) {
    return { ok: false, reason: `Level Up to ${incoming.level} needs ${cost} cards to discard` };
  }
  return { ok: true };
}

// --- End Phase -------------------------------------------------------------

/**
 * End of turn: revealed cards in the Action Zone go to the trash, then the
 * turn player discards down to the hand limit. Returns a new state.
 *
 * `discardChoice` picks which cards to throw away when over the limit; the
 * default keeps the cards on the left. The UI should ask the player instead.
 */
export function applyEndPhase(
  state: MatchState,
  playerId: string,
  discardChoice?: (hand: PlayerBoard["hand"], keep: number) => PlayerBoard["hand"]
): MatchState {
  const next = structuredClone(state);
  const board = next.boards[playerId];
  if (!board) return next;

  // Clear the Action Area into the trash.
  const revealed = next.actionZone[playerId] ?? [];
  board.trash.push(...revealed);
  next.actionZone[playerId] = [];

  // Discard down to the hand limit.
  if (board.hand.length > HAND_LIMIT) {
    const kept = discardChoice
      ? discardChoice(board.hand, HAND_LIMIT)
      : board.hand.slice(0, HAND_LIMIT);
    const discarded = board.hand.filter((card) => !kept.includes(card));
    board.trash.push(...discarded);
    board.hand = kept.slice(0, HAND_LIMIT);
  }

  board.actionsTakenThisTurn = [];
  return next;
}

// --- The turn log ----------------------------------------------------------
//
// Abilities constantly ask about things that leave no trace on the board:
// whether the opponent took damage this turn, whether a card has been played
// yet, how many times an ability has already fired. The engine records those
// as they happen; these are the hooks it calls.

/** Wipes the log. Call at the start of every turn. */
export function resetTurnLog(state: MatchState): MatchState {
  const next = structuredClone(state);
  next.turnLog = emptyTurnLog();
  // "Next round your opponent cannot use follow-up attacks" was booked when
  // the ability resolved; this is the turn it starts applying.
  next.turnLog.flags = next.pendingFlags;
  next.pendingFlags = {};
  return next;
}

/** Records that a player played a card. Call whenever a card leaves hand. */
export function recordCardPlayed(
  state: MatchState,
  playerId: string,
  card: ActionCard
): MatchState {
  const next = structuredClone(state);
  const played = (next.turnLog.cardsPlayed[playerId] ??= []);
  played.push(card);
  return next;
}

/** Records damage that did not come from a card effect, e.g. combat damage. */
export function recordDamage(state: MatchState, playerId: string, amount: number): MatchState {
  const next = structuredClone(state);
  next.turnLog.damageTaken[playerId] = (next.turnLog.damageTaken[playerId] ?? 0) + amount;
  return next;
}

// --- Win condition ---------------------------------------------------------

/**
 * A player at 0 Life or less has lost. Returns the winner's id, "draw" if
 * both hit zero at once, or null while the game is still going.
 */
export function checkWinner(state: MatchState): string | "draw" | null {
  const dead = Object.values(state.boards).filter((board) => board.life <= 0);
  if (dead.length === 0) return null;
  if (dead.length > 1) return "draw";

  const loser = dead[0].playerId;
  return Object.keys(state.boards).find((id) => id !== loser) ?? "draw";
}
