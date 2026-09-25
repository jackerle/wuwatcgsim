// Turn structure, deck legality and win conditions.
//
// game.ts holds the shapes and the combat maths; this file holds the rules
// that drive a turn forward. Everything here is a pure function over
// MatchState so the server can run it and the client can predict with it.

import type { ActionCard, CharacterLevel } from "./game";
import {
  characterStack,
  cloneData,
  emptyTurnLog,
  HAND_LIMIT,
  shuffleWithState,
  type ActionKind,
  type CharacterCard,
  type CharacterInstance,
  type MatchState,
  type PlayerBoard,
  type TurnPhase,
} from "./game";
import { LOG, type LogLine } from "./log";

// --- Deck building ---------------------------------------------------------

export const CHARACTER_DECK_MIN = 3;
export const CHARACTER_DECK_MAX = 15;
export const ACTION_DECK_SIZE = 40;
/**
 * How tall one character's pile may get. "Levelling up, by whatever means,
 * cannot stack a character past 5 cards — a character already totalling 5
 * cannot be an upgrade source", so this binds ability-driven level ups too, not
 * only the once-a-turn Action Phase one.
 */
export const CHARACTER_STACK_MAX = 5;

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
 *
 * "leaderSelect" and "mulligan" are deliberately absent: each happens once,
 * before turn 1, and the turn cycle never reaches either again.
 * nextPhase("leaderSelect")/nextPhase("mulligan") are therefore null, and the
 * engine moves out of them by hand once both players have chosen.
 */
export const TURN_PHASE_ORDER: readonly TurnPhase[] = [
  "draw",
  "action",
  "counter",
  "combo",
  "end",
] as const;

export const PHASE_LABEL: Record<TurnPhase, { en: string; th: string }> = {
  leaderSelect: { en: "Choose Leader", th: "เลือก Leader" },
  mulligan: { en: "Mulligan", th: "เปลี่ยนการ์ดในมือ" },
  draw: { en: "Draw Phase", th: "เฟสจั่ว" },
  action: { en: "Action Phase", th: "เฟสแอ็กชัน" },
  // `counter` is the engine's name for it, and the cards print [Counter];
  // the game's own word for the step is Battle, and that is what a player
  // reads — here and in KEYWORD_LABEL.
  counter: { en: "Battle Phase", th: "เฟสประลอง" },
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

/**
 * Shuffles the trash back into an empty deck, and says whether it did.
 *
 * Running the deck out is not a loss in these rules — the pile is recycled
 * and play continues — so this is the whole of that rule. It fires only on
 * an EMPTY deck: a deck with one card left is not out yet, and mixing the
 * trash in underneath while a card is still on top would quietly change
 * which card comes off next.
 */
export function recycleTrash(state: MatchState, board: PlayerBoard, log?: LogLine[]): boolean {
  if (board.actionDeck.length > 0 || board.trash.length === 0) return false;
  board.actionDeck = shuffleWithState(state, board.trash);
  board.trash = [];
  log?.push(LOG.recyclesTrash(board.playerId, board.actionDeck.length));
  return true;
}

/**
 * Rebuilds any deck that has run out, from that player's trash.
 *
 * The rules rebuild a deck the moment it reaches 0 — but NOT in the middle of
 * an effect: "if the deck becomes 0 for another reason while a skill is
 * resolving, wait until every skill has finished resolving, then rebuild".
 * Drawing is the one exception, handled inside takeFromDeck. So this is the
 * sweep that runs between steps, and it is why an effect that reveals the top
 * 5 of a 2-card deck sees 2 cards rather than a freshly shuffled deck.
 */
export function rebuildEmptyDecks(state: MatchState, log?: LogLine[]): void {
  // recycleTrash is a no-op unless the deck is empty and the trash is not, so
  // this is safe to call as often as we like.
  for (const board of Object.values(state.boards)) recycleTrash(state, board, log);
}

/**
 * Takes `count` cards off the top of a deck.
 *
 * `recycle` decides what happens when the deck runs dry part-way through, and
 * the two behaviours are different RULES, not a convenience:
 *
 *   true  — DRAWING. "Draw 2" with one card left takes that card, rebuilds the
 *           deck from the trash, and takes the second off the new deck, so the
 *           draw always completes. This is the rule's explicit exception.
 *   false — every other way cards leave the top: revealing, milling, charging
 *           from the deck, taking the top N to hand. Those take what is
 *           actually there and the rebuild waits for rebuildEmptyDecks(), per
 *           the rule above. Revealing the top 5 of a 2-card deck reveals 2.
 *
 * Returns fewer cards than asked when the deck runs out — with `recycle`, only
 * when both piles are empty.
 */
export function takeFromDeck(
  state: MatchState,
  board: PlayerBoard,
  count: number,
  log?: LogLine[],
  { recycle = true }: { recycle?: boolean } = {}
): ActionCard[] {
  const taken: ActionCard[] = [];
  while (taken.length < count) {
    if (board.actionDeck.length === 0) {
      if (!recycle || !recycleTrash(state, board, log)) {
        // Nothing left to give: either the rebuild is not ours to do here, or
        // deck and trash are both empty. Not a loss, but not something to pass
        // over in silence either.
        log?.push(LOG.deckEmpty(board.playerId));
        break;
      }
    }
    taken.push(board.actionDeck.shift()!);
  }
  return taken;
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
/**
 * Whether anything more may be stacked on this character.
 *
 * Separate from canLevelUpOnto because it is about the PILE rather than the two
 * cards, and because it binds both routes into play — the Action Phase rule and
 * a card's own "level this character up" ability.
 */
export function canStackOnto(slot: CharacterInstance): RuleCheck {
  const height = characterStack(slot).length;
  if (height >= CHARACTER_STACK_MAX) {
    return {
      ok: false,
      reason: `${slot.card.name} is already ${height} cards tall — a character cannot stack past ${CHARACTER_STACK_MAX}`,
    };
  }
  return { ok: true };
}

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
 * End of turn for one player: their Action Area goes to the trash, and — only
 * when `discardToLimit` is set — they discard down to the hand limit.
 *
 * The two halves are separate because the rules apply them to different people:
 * EVERY player's Action Area is emptied, but only the TURN player discards to 8.
 * Running the hand limit over both sides quietly took cards off a player on a
 * turn that was never theirs.
 *
 * `discardChoice` picks which cards to throw away when over the limit; the
 * default keeps the cards on the left. The UI should ask the player instead.
 */
export function applyEndPhase(
  state: MatchState,
  playerId: string,
  discardChoice?: (hand: PlayerBoard["hand"], keep: number) => PlayerBoard["hand"],
  { discardToLimit = true }: { discardToLimit?: boolean } = {}
): MatchState {
  const next = cloneData(state);
  const board = next.boards[playerId];
  if (!board) return next;

  // Clear the Action Area into the trash.
  const revealed = next.actionZone[playerId] ?? [];
  board.trash.push(...revealed);
  next.actionZone[playerId] = [];

  // Discard down to the hand limit — the turn player's obligation, nobody else's.
  if (discardToLimit && board.hand.length > HAND_LIMIT) {
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
  const next = cloneData(state);
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
  const next = cloneData(state);
  const played = (next.turnLog.cardsPlayed[playerId] ??= []);
  played.push(card);
  return next;
}

/**
 * Records a character card reaching the field, however it got there.
 *
 * Levelling up is the only way one does, so this sits beside every level up
 * — the Action Phase move and the ability that does it for you.
 */
export function recordCharacterPlayed(
  state: MatchState,
  playerId: string,
  cardId: string
): MatchState {
  const next = cloneData(state);
  const played = (next.turnLog.charactersPlayed[playerId] ??= []);
  if (!played.includes(cardId)) played.push(cardId);
  return next;
}

/** Records damage that did not come from a card effect, e.g. combat damage. */
export function recordDamage(state: MatchState, playerId: string, amount: number): MatchState {
  const next = cloneData(state);
  next.turnLog.damageTaken[playerId] = (next.turnLog.damageTaken[playerId] ?? 0) + amount;
  // Counted even when the amount came out at zero: a hit that was reduced to
  // nothing still happened, and an ability that only softens the first one
  // has spent itself on it.
  next.turnLog.hitsTaken[playerId] = (next.turnLog.hitsTaken[playerId] ?? 0) + 1;
  return next;
}

// --- Win condition ---------------------------------------------------------

/**
 * A player at 0 Life or less has lost. Returns the winner's id, "draw" if
 * both hit zero at once, or null while the game is still going.
 */
export function checkWinner(state: MatchState): string | "draw" | null {
  // Two ways to lose, checked together because they can land at once and that
  // is a draw: Life at 0, and — the one that is easy to forget — having neither
  // a deck NOR a trash left. An empty deck on its own is not a loss: the trash
  // is shuffled into a new deck first (see rebuildEmptyDecks). It is when there
  // is nothing left to rebuild FROM that the player is out.
  const dead = Object.values(state.boards).filter(
    (board) => board.life <= 0 || (board.actionDeck.length === 0 && board.trash.length === 0)
  );
  if (dead.length === 0) return null;
  if (dead.length > 1) return "draw";

  const loser = dead[0].playerId;
  return Object.keys(state.boards).find((id) => id !== loser) ?? "draw";
}
