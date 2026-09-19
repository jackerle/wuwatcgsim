// The turn engine: the thing that actually drives a game forward.
//
// Everything underneath this file is a piece — rules.ts knows what is legal,
// effects.ts knows how one trigger resolves, game.ts knows who wins a clash.
// This file is the loop that calls them in the right order, at the right
// moment, and hands the result back.
//
// The whole engine is one function, `step`, and it is pure: the same state
// plus the same intent plus the same answers always produce the same result.
// Nothing here reads a clock or a random number — a shuffle happens once, at
// setup, and after that the deck order lives in the state.
//
// --- How a question suspends a step ---------------------------------------
//
// A card may stop half-way through a phase to ask its controller something.
// Rather than make every one of these functions async, a step that hits a
// question rewinds and reports it: `pending` comes back set, and `state` is
// returned UNCHANGED. The caller shows the question, then calls `step` again
// with exactly the same arguments and the answer appended:
//
//     let answers = [];
//     let out = step(state, me, { kind: "resolveCounter" }, answers);
//     while (out.pending) {
//       answers = [...answers, await askThePlayer(out.pending)];
//       out = step(state, me, { kind: "resolveCounter" }, answers);
//     }
//
// Because `state` never advances until the step completes, replaying is safe
// however many questions a phase ends up asking. `preview` carries the
// partially-applied board for display only — never feed it back in.

import { getCard } from "./cardDb";
import { LOG, type LogLine } from "./log";
import type { ChoiceAnswer, PendingChoice } from "./cardDef";
import { effectiveStats, type EffectTrigger } from "./cards";
import {
  comboLookupFromDb,
  damageTakenModifier,
  effectiveCost,
  expireModifiers,
  filterableFor,
  grantedFor,
  qualifyingModifiers,
  zoneBlocking,
  makeCursor,
  recomputeContinuous,
  resolveTriggerWith,
  type AnswerCursor,
  type EffectSource,
  type ResolvedEffect,
} from "./effects";
import {
  ACTION_ZONE_MAX_CARDS,
  characterStack,
  emptyMatchState,
  CHARACTERS_IN_PLAY,
  CHARGE_PER_TURN,
  HAND_LIMIT,
  INITIAL_HAND_SIZE,
  resolveCombat,
  shuffleWithState,
  STARTING_LIFE,
  type ActionCard,
  type CombatResult,
  type ActionKind,
  type CharacterCard,
  type CombatReason,
  type CharacterInstance,
  type MatchState,
  type PlayerBoard,
  hiddenActionCard,
} from "./game";
import {
  applyEndPhase,
  canLevelUpOnto,
  canStackOnto,
  canTakeAction,
  checkWinner,
  drawCount,
  levelUpCost,
  MAX_ACTIONS_PER_TURN,
  recordCardPlayed,
  recordCharacterPlayed,
  recordDamage,
  rebuildEmptyDecks,
  resetTurnLog,
  takeFromDeck,
  validateDecks,
} from "./rules";

// --- Setup -----------------------------------------------------------------

export interface PlayerSetup {
  playerId: string;
  /** 3-15 cards. The level 0 card is placed as the starting Leader. */
  characterDeck: CharacterCard[];
  /** Exactly 40 cards, already shuffled — the engine never shuffles. */
  actionDeck: ActionCard[];
}

export interface MatchSetup {
  matchId: string;
  players: [PlayerSetup, PlayerSetup];
  startingPlayerId: string;
  /**
   * Deal straight into turn 1 instead of opening on the mulligan.
   *
   * For fixtures that are about the turn itself and would otherwise have to
   * play two opening moves before reaching the rule under test. A real match
   * never sets it — see dealMatch().
   */
  skipMulligan?: boolean;
}

/** A stable seed from the match id, so the same match always plays the same. */
function hashSeed(matchId: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < matchId.length; i += 1) {
    hash ^= matchId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash || 0x9e3779b9;
}

function emptyBoard(playerId: string): PlayerBoard {
  return {
    playerId,
    life: STARTING_LIFE,
    leader: null,
    back: [],
    characterPool: [],
    actionDeck: [],
    hand: [],
    competitionArea: [],
    trash: [],
    actionsTakenThisTurn: [],
  };
}

/**
 * Builds the opening position: Leaders down, opening hands drawn, and the
 * board waiting on the mulligan — after which turn 1 belongs to
 * `startingPlayerId`, on its Draw Phase.
 *
 * Decks are used in the order given, so shuffle before calling. Throws if
 * either deck is illegal — the caller should have run validateDecks first and
 * shown the player what is wrong.
 */
export function createMatch(setup: MatchSetup): MatchState {
  const state: MatchState = {
    ...emptyMatchState(
      setup.matchId,
      setup.players.map((player) => player.playerId)
    ),
    turnPlayerId: setup.startingPlayerId,
    startingPlayerId: setup.startingPlayerId,
    phase: setup.skipMulligan ? "draw" : "mulligan",
    // Seeded from the match id so two matches do not deal the same randomness,
    // while one match stays perfectly replayable.
    rngSeed: hashSeed(setup.matchId),
  };

  for (const player of setup.players) {
    const issues = validateDecks(player.characterDeck, player.actionDeck);
    if (issues.length > 0) {
      throw new Error(`${player.playerId}: ${issues.map((i) => i.message).join("; ")}`);
    }

    const board = emptyBoard(player.playerId);
    const deck = [...player.actionDeck];
    board.hand = deck.splice(0, INITIAL_HAND_SIZE);
    board.actionDeck = deck;

    // Three characters start on the field — one Leader and two behind — and
    // they have to be three DIFFERENT characters, since a Level 0 card is
    // where each one begins. The rest of the Character Deck waits in the pool
    // to be played on top of them as Level Ups.
    const pool = [...player.characterDeck];
    const starters: CharacterCard[] = [];
    for (const name of new Set(pool.map((card) => card.name))) {
      if (starters.length >= CHARACTERS_IN_PLAY) break;
      const at = pool.findIndex((card) => card.name === name && card.level === 0);
      if (at >= 0) starters.push(pool.splice(at, 1)[0]);
    }
    if (starters.length < CHARACTERS_IN_PLAY) {
      throw new Error(
        `${player.playerId}: needs ${CHARACTERS_IN_PLAY} different characters with a Level 0 card` +
          ` to start (found ${starters.length})`
      );
    }
    board.leader = { position: "leader", card: starters[0], under: [] };
    board.back = starters.slice(1).map((card) => ({
      position: "back" as const,
      card,
      under: [],
    }));
    board.characterPool = pool;

    state.boards[player.playerId] = board;
    state.facedown[player.playerId] = null;
    state.committed[player.playerId] = false;
    state.mulliganDone[player.playerId] = Boolean(setup.skipMulligan);
    state.actionZone[player.playerId] = [];
  }

  // Leader Skills and passives are live from the first moment.
  return recomputeContinuous(state).state;
}

// --- Intents ---------------------------------------------------------------

/**
 * Everything a player (or the engine on their behalf) can ask to happen.
 * One intent is one atomic step: it either completes, stops to ask a
 * question, or is rejected with a reason.
 */
export type MatchIntent =
  /**
   * Opening mulligan: put any number of the five cards back, shuffle, and
   * draw that many again. An empty list is the "keep this hand" answer, and
   * still counts as having chosen.
   */
  | { kind: "mulligan"; cardIds: string[] }
  /** Begin the turn player's turn: reset, draw, raise [At start of turn]. */
  | { kind: "startTurn" }
  /** Action Phase: move cards from hand into the Concerto area. */
  | { kind: "charge"; cardIds: string[] }
  /** Action Phase: play a higher-level card onto a character in play. */
  | { kind: "levelUp"; characterId: string; discardIds: string[] }
  /** Action Phase: swap the Leader with one of the back characters. */
  | { kind: "switch"; toCardId: string }
  /**
   * Close the Action Phase and open the Counter Phase.
   *
   * The turn player's alone, and the ONLY way in by hand — laying a card out
   * no longer opens the phase. The two used to be the same move, which meant
   * the player who laid the first card decided when everybody's Action Phase
   * ended, and on the other side of the table that ended it early.
   *
   * The engine also opens the phase itself once all three Action Phase moves
   * are spent, since nothing is left to do there.
   */
  | { kind: "toBattle" }
  /** Commit a card face-down for the clash. Both sides must choose. */
  | { kind: "commit"; cardId: string }
  /** Counter Phase: choose to play nothing — an empty hand, or by choice. */
  | { kind: "pass" }
  /**
   * Skip the Counter Phase outright and go to the End Phase. The turn player's
   * alternative to `toBattle` when they leave the Action Phase.
   */
  | { kind: "skipCounter" }
  /** Give up. The other player wins immediately. */
  | { kind: "concede" }
  /** Turn both cards up and play the clash out to its damage. */
  | { kind: "resolveCounter" }
  /** Combo Step: the battle winner extends with another card. */
  | { kind: "combo"; cardId: string }
  /** Combo Step: stop extending. */
  | { kind: "passCombo" }
  /** End Phase: clear the Action Area, discard down, pass the turn. */
  | { kind: "endTurn" };

export interface StepResult {
  /**
   * The board after the step. When `pending` is set this is the state
   * UNCHANGED, so it is always safe to pass straight back into `step`.
   */
  state: MatchState;
  /** A question that must be answered before the step can finish. */
  pending: PendingChoice | null;
  /** Effects nobody has written code for — the players apply these by hand. */
  manual: ResolvedEffect[];
  /** What happened, oldest first, for the battle log. */
  log: LogLine[];
  /** Set when the intent was illegal. The state is untouched. */
  error: string | null;
  /**
   * Display only. While `pending` is set this is the half-applied board, so
   * the UI can show what has already happened behind the question. Never
   * feed it back into `step`.
   */
  preview: MatchState;
}

// --- The run ---------------------------------------------------------------

/** Thrown to abandon a step: either a question came up, or the intent was illegal. */
class Suspended {
  readonly pending: PendingChoice | null;
  readonly error: string | null;

  constructor(pending: PendingChoice | null, error: string | null) {
    this.pending = pending;
    this.error = error;
  }
}

/**
 * The working copy of a single step. Holds the board being mutated, the
 * shared answer cursor, and everything worth reporting afterwards.
 */
class Run {
  state: MatchState;
  readonly cursor: AnswerCursor;
  readonly log: LogLine[] = [];
  readonly manual: ResolvedEffect[] = [];
  /** cardId + effect index of every manual effect already reported. */
  private readonly reported = new Set<string>();

  constructor(state: MatchState, answers: ChoiceAnswer[]) {
    this.state = structuredClone(state);
    this.cursor = makeCursor(answers);
  }

  /**
   * Adds manual effects, skipping any already listed.
   *
   * A step settles continuous effects several times over, and an always-on
   * ability with no code is reported by every one of those passes. Without
   * this the player would be told to apply the same Leader Skill three times
   * for one action.
   */
  private collectManual(entries: ResolvedEffect[]): void {
    for (const entry of entries) {
      const key = `${entry.cardId}#${entry.controllerId}#${entry.effect.text.en ?? entry.effect.text.th ?? ""}`;
      if (this.reported.has(key)) continue;
      this.reported.add(key);
      this.manual.push(entry);
    }
  }

  /** Rejects the intent. Nothing done so far is kept. */
  reject(reason: string): never {
    throw new Suspended(null, reason);
  }

  /**
   * Raises a trigger that the whole board gets to answer — the clash, the
   * start of a turn, a phase boundary. Both players' cards react.
   */
  fire(trigger: EffectTrigger): void {
    this.fireOn(trigger, sourcesOnBoard(this.state));
  }

  /**
   * Raises a trigger for one player's cards only. Nothing uses this yet: the
   * Counter Phase happens for both sides, so every phase trigger goes out
   * board-wide and each card's own conditions decide whether it applies.
   */
  fireFor(trigger: EffectTrigger, playerId: string): void {
    this.fireOn(
      trigger,
      sourcesOnBoard(this.state).filter((source) => source.controllerId === playerId)
    );
  }

  /**
   * Raises a trigger that belongs to one specific card. [Enter], [Level up]
   * and [Combo] all read as "when THIS card does it", so they must never go
   * out board-wide: a second character carrying [Enter] would fire every time
   * anything at all was played.
   */
  fireOn(trigger: EffectTrigger, sources: EffectSource[]): void {
    const result = resolveTriggerWith(this.state, trigger, sources, this.cursor);
    this.state = result.state;
    this.collectManual(result.manual);
    for (const entry of result.resolved) {
      for (const line of entry.log) this.log.push(creditCard(line, entry.cardId));
    }
    if (result.pending) throw new Suspended(result.pending, null);

    // A trigger may switch Leader, level a character up, return a character,
    // or otherwise activate/deactivate a continuous source. Stat-dependent
    // work immediately after it — Counter's clash calculation, Judgement's
    // final primary damage and a Combo card's hit — must see that new board,
    // not the passives from before the trigger fired. Keep this AFTER the
    // pending check: a question replays the whole step from its original
    // state, so settling a half-resolved trigger would corrupt the replay.
    this.settle();
  }

  /**
   * Rebuilds every always-on effect. Call after anything that could change
   * what a passive sees: a card entering or leaving play, a level up, a
   * switch, the turn passing.
   */
  settle(): void {
    // A deck that ran out is rebuilt from the trash HERE rather than inside the
    // effect that emptied it: the rules defer the rebuild until every skill has
    // finished resolving, and settle() is exactly the boundary between steps.
    // Drawing is the one exception and handles itself (see takeFromDeck).
    rebuildEmptyDecks(this.state, this.log);
    const result = recomputeContinuous(this.state);
    this.state = result.state;
    this.collectManual(result.manual);
    // Deliberately NOT logged. Continuous effects are thrown away and rebuilt
    // several times per step, so logging them would fill the battle log with
    // the same handful of lines over and over. The log records events; what
    // the passives currently add shows up in the card's own numbers.

  }

  board(playerId: string): PlayerBoard {
    const board = this.state.boards[playerId];
    if (!board) this.reject(`No board for player "${playerId}"`);
    return board;
  }

  /** A line the engine itself wrote, optionally crediting a card for it. */
  note(message: LogLine, cardId?: string): void {
    this.log.push(cardId ? creditCard(message, cardId) : message);
  }
}

/**
 * Names the card a log line came from, as "[BP01-076]" at the end.
 *
 * The convention was already there — every damage line says which card dealt
 * it — this just makes it hold for every line an effect produces, so the
 * battle log can show the card beside what it did instead of a wall of
 * sentences that all look alike. Lines that already name a card are left
 * alone rather than credited twice.
 */
function creditCard(entry: LogLine, cardId: string): LogLine {
  const already = (text: string) => /\[[A-Z]{2}\d{2}-\d{3}[^\]]*\]/.test(text);
  return {
    th: already(entry.th) ? entry.th : `${entry.th} [${cardId}]`,
    en: already(entry.en) ? entry.en : `${entry.en} [${cardId}]`,
  };
}

/**
 * Every card on the board that could carry a trigger: characters in play, and
 * action cards sitting face-up in an Action Zone. A card in hand or in the
 * trash is not a source — the effects that reach out of those zones are
 * raised by the code that moves the card.
 */
function sourcesOnBoard(state: MatchState): EffectSource[] {
  const sources: EffectSource[] = [];
  // The rules resolve skills "ターンプレイヤー→非ターンプレイヤーの順" — turn
  // player first, then the other. Object key order would otherwise decide it,
  // which is however the boards happened to be built.
  const order = [
    state.turnPlayerId,
    ...Object.keys(state.boards).filter((id) => id !== state.turnPlayerId),
  ];
  for (const playerId of order) {
    const board = state.boards[playerId];
    if (!board) continue;
    for (const slot of [board.leader, ...board.back]) {
      if (!slot) continue;
      sources.push(...sourcesForSlot(slot, playerId));
    }
    for (const card of state.actionZone[playerId] ?? []) {
      const definition = getCard(card.id);
      if (definition) {
        sources.push({
          card: definition,
          controllerId: playerId,
          zone: "actionZone",
          granted: grantedFor(state, card, playerId),
        });
      }
    }
  }
  return sources;
}

/** Just the one card, as a source — for [Enter] and [Combo] on the card being played. */
function sourceForCard(
  state: MatchState,
  card: ActionCard,
  controllerId: string
): EffectSource[] {
  const definition = getCard(card.id);
  if (!definition) return [];
  return [
    {
      card: definition,
      controllerId,
      zone: "actionZone",
      granted: grantedFor(state, card, controllerId),
    },
  ];
}

/** The character that just levelled up or switched in, as a source. */
function sourceForCharacter(
  card: CharacterCard,
  controllerId: string,
  zone: "leader" | "back"
): EffectSource[] {
  const definition = getCard(card.id);
  return definition ? [{ card: definition, controllerId, zone }] : [];
}

/**
 * Every card in a character's pile, as sources.
 *
 * A levelled-up character is a stack, and every card in it is still in play —
 * the Level 1 skill does not stop working once Level 2 is played on top of
 * it. So each card in the pile answers a trigger on its own.
 */
function sourcesForSlot(slot: CharacterInstance, controllerId: string): EffectSource[] {
  const zone = slot.position === "leader" ? "leader" : "back";
  return characterStack(slot).flatMap((card) => sourceForCharacter(card, controllerId, zone));
}

// --- Paying for a card -----------------------------------------------------

/**
 * Paying a cost spends charged cards. The Concerto area is a pile of energy,
 * not a threshold to clear: playing a cost 2 card uses two of the cards
 * charged there and they go to the trash.
 *
 * Since a player may only charge one card per turn, this is the tightest
 * constraint in the game — a cost 2 card is two turns of charging.
 */
function canPay(board: PlayerBoard, cost: number): boolean {
  return board.competitionArea.length >= cost;
}

function payCost(board: PlayerBoard, cost: number): void {
  // Oldest first, so the pile reads in the order it was charged.
  const spent = board.competitionArea.splice(0, cost);
  board.trash.push(...spent);
}

/**
 * What the card asks for right now — the printed cost plus anything that has
 * changed it, like "[Advantage] this card costs 1 less".
 */
function costOf(state: MatchState, card: ActionCard, playerId: string): number {
  return effectiveCost(state, card, playerId);
}

/**
 * Cards printed "can only be played from an ability" — they may not be laid
 * down by hand, only put into play by another card.
 */
function isAbilityOnly(cardId: string): boolean {
  return Boolean(getCard(cardId)?.effects.some((effect) => effect.tags?.includes("abilityOnly")));
}

/**
 * Why this card cannot be laid down, or null when it can. One place for every
 * reason: cost, the Action Area caps, and cards that may only be put into
 * play by an ability rather than from hand.
 */
function playBlocking(state: MatchState, card: ActionCard, playerId: string): string | null {
  if (isAbilityOnly(card.id)) {
    return `${card.name} can only be put into play by an ability`;
  }
  const capped = zoneBlocking(state, card, playerId);
  if (capped) return capped;

  const board = state.boards[playerId];
  const cost = costOf(state, card, playerId);
  if (!board || !canPay(board, cost)) {
    return `${card.name} costs ${cost} — not enough in the Concerto area`;
  }
  return null;
}

// --- The step --------------------------------------------------------------

/**
 * Advances the match by one intent.
 *
 * `playerId` is whoever is asking; an intent from the wrong player, in the
 * wrong phase, or against the rules comes back as `error` with the state
 * untouched. See the file header for how `pending` and `answers` work.
 */
export function step(
  state: MatchState,
  playerId: string,
  intent: MatchIntent,
  answers: ChoiceAnswer[] = []
): StepResult {
  const run = new Run(state, answers);

  try {
    apply(run, playerId, intent);
  } catch (error) {
    if (error instanceof Suspended) {
      // Either a question or a rejection: the caller keeps the state it had.
      return {
        state,
        pending: error.pending,
        manual: run.manual,
        log: run.log,
        error: error.error,
        preview: run.state,
      };
    }
    throw error;
  }

  // Checked once per step, after the rebuild sweep in settle() has had its go:
  // an empty deck is only a loss when the trash was empty too, so asking before
  // the rebuild would kill a player who still had cards to shuffle back.
  const winner = checkWinner(run.state);
  if (winner && !run.state.winnerId) {
    run.state.winnerId = winner;
    run.note(winner === "draw" ? LOG.matchDraw() : LOG.wins(winner));
  }

  return {
    state: run.state,
    pending: null,
    manual: run.manual,
    log: run.log,
    error: null,
    preview: run.state,
  };
}

function apply(run: Run, playerId: string, intent: MatchIntent): void {
  if (run.state.winnerId) run.reject("The match is already over");

  switch (intent.kind) {
    case "mulligan":
      return mulligan(run, playerId, intent.cardIds);
    case "startTurn":
      return startTurn(run);
    case "charge":
      return charge(run, playerId, intent.cardIds);
    case "levelUp":
      return levelUp(run, playerId, intent.characterId, intent.discardIds);
    case "switch":
      return switchLeader(run, playerId, intent.toCardId);
    case "toBattle":
      return toBattle(run, playerId);
    case "commit":
      return commit(run, playerId, intent.cardId);
    case "skipCounter":
      skipCounter(run, playerId);
      break;
    case "pass":
      return passCounter(run, playerId);
    case "concede":
      return concede(run, playerId);
    case "resolveCounter":
      return resolveCounter(run);
    case "combo":
      return playCombo(run, playerId, intent.cardId);
    case "passCombo":
      return passCombo(run, playerId);
    case "endTurn":
      return endTurn(run, playerId);
  }
}

// --- Mulligan --------------------------------------------------------------

/**
 * One player's opening mulligan: the named cards go back into the deck, the
 * deck is shuffled, and they draw the same number again.
 *
 * Both players do this at once and in either order, so the phase does not end
 * on this call — it ends on whichever call is the last one in. An empty
 * `cardIds` is a real answer ("keep this hand"), not a no-op: it is how a
 * player who likes their five says so and lets the game start.
 */
function mulligan(run: Run, playerId: string, cardIds: string[]): void {
  if (run.state.phase !== "mulligan") run.reject("The mulligan is over");
  if (run.state.mulliganDone[playerId]) run.reject("You have already chosen your opening hand");

  const board = run.board(playerId);
  // Taken out by POSITION, one id at a time: a hand can hold two copies of
  // one printed card, and matching on id alone would put the same one back
  // twice and lose the other.
  const keeping = [...board.hand];
  const putBack: ActionCard[] = [];
  for (const cardId of cardIds) {
    const index = keeping.findIndex((card) => card.id === cardId);
    if (index < 0) run.reject(`${cardId} is not in hand`);
    putBack.push(...keeping.splice(index, 1));
  }

  if (putBack.length > 0) {
    board.hand = keeping;
    // Back in, then shuffled — the cards must not be sitting where whoever
    // put them there could count them off the top.
    board.actionDeck = shuffleWithState(run.state, [...board.actionDeck, ...putBack]);
    board.hand.push(...takeFromDeck(run.state, board, putBack.length, run.log));
    run.note(LOG.mulligans(playerId, putBack.length));
  } else {
    run.note(LOG.keepsHand(playerId));
  }

  run.state.mulliganDone[playerId] = true;
  if (Object.keys(run.state.boards).every((id) => run.state.mulliganDone[id])) {
    run.state.phase = "draw";
    run.note(LOG.mulliganOver());
  }
}

// --- Draw Phase ------------------------------------------------------------

function startTurn(run: Run): void {
  if (run.state.phase !== "draw") run.reject(`Cannot start a turn during the ${run.state.phase} phase`);

  const turnPlayer = run.state.turnPlayerId;
  run.state = resetTurnLog(run.state);
  // [Advantage] changes hands here and nowhere else. It was decided by last
  // turn's clash, and winning did NOT grant it for the rest of that turn — this
  // is the turn it starts counting. Promoting it once, here, is also what keeps
  // it still for the whole turn: this turn's clash books the next holders into
  // pendingAdvantageIds without disturbing these.
  run.state.advantageIds = run.state.pendingAdvantageIds;
  run.state.pendingAdvantageIds = [];
  for (const board of Object.values(run.state.boards)) {
    board.actionsTakenThisTurn = [];
  }

  const count = drawCount(run.state.turnNumber, turnPlayer === run.state.startingPlayerId);
  const board = run.board(turnPlayer);
  // Running the deck out is not a loss: takeFromDeck shuffles the trash back
  // in and carries on, and writes its own line saying so.
  const drawn = takeFromDeck(run.state, board, count, run.log);
  board.hand.push(...drawn);
  run.note(LOG.draws(turnPlayer, drawn.length));

  run.fire("turnStart");
  run.settle();
  run.state.phase = "action";
}

// --- Action Phase ----------------------------------------------------------

function takeAction(run: Run, playerId: string, kind: ActionKind): void {
  if (run.state.phase !== "action") run.reject(`${kind} is an Action Phase action`);
  if (playerId !== run.state.turnPlayerId) run.reject("It is not your turn");

  const check = canTakeAction(run.board(playerId), kind);
  if (!check.ok) run.reject(check.reason ?? `Cannot ${kind} right now`);
  run.board(playerId).actionsTakenThisTurn.push(kind);
}

function charge(run: Run, playerId: string, cardIds: string[]): void {
  // One card per turn — charging is a single point of energy, not a handful.
  if (cardIds.length !== CHARGE_PER_TURN) {
    run.reject(`Charge takes exactly ${CHARGE_PER_TURN} card from hand`);
  }
  takeAction(run, playerId, "charge");
  const board = run.board(playerId);

  const index = board.hand.findIndex((card) => card.id === cardIds[0]);
  if (index < 0) run.reject(`${cardIds[0]} is not in hand`);
  board.competitionArea.push(board.hand.splice(index, 1)[0]);
  run.note(LOG.charges(playerId, board.competitionArea.length));
  run.settle();
  advanceIfActionsSpent(run, playerId);
}

function levelUp(run: Run, playerId: string, characterId: string, discardIds: string[]): void {
  takeAction(run, playerId, "levelUp");
  const board = run.board(playerId);

  const poolIndex = board.characterPool.findIndex((card) => card.id === characterId);
  if (poolIndex < 0) run.reject(`${characterId} is not in the Character Deck`);
  const incoming = board.characterPool[poolIndex];

  // Level Up goes onto the card already in play naming the same character.
  const slots = [board.leader, ...board.back];
  const target = slots.find((slot) => slot?.card.name === incoming.name);
  if (!target) run.reject(`${incoming.name} is not in play to level up`);

  if (isAbilityOnly(incoming.id)) {
    run.reject(`${incoming.name} Lv.${incoming.level} can only be put into play by an ability`);
  }
  const stack = canStackOnto(target);
  if (!stack.ok) run.reject(stack.reason ?? "Cannot level up");
  const check = canLevelUpOnto(target.card, incoming, board);
  if (!check.ok) run.reject(check.reason ?? "Cannot level up");

  const cost = levelUpCost(incoming.level);
  if (discardIds.length !== cost) {
    run.reject(`Level Up to ${incoming.level} costs exactly ${cost} card(s) from hand`);
  }
  for (const cardId of discardIds) {
    const index = board.hand.findIndex((card) => card.id === cardId);
    if (index < 0) run.reject(`${cardId} is not in hand`);
    board.trash.push(board.hand.splice(index, 1)[0]);
  }

  // The character keeps everything they were: the new card goes on top and
  // the card it was played over stays underneath it, so the slot reads as the
  // pile it is on the table.
  board.characterPool.splice(poolIndex, 1);
  target.under.push(target.card);
  target.card = incoming;
  // Captured before settle(), which may hand back a fresh state object and
  // leave `target` pointing at the old one. Ids are all the firing needs.
  const beneath = target.under.map((card) => card);
  const zone = target.position === "leader" ? "leader" : "back";
  run.state = recordCharacterPlayed(run.state, playerId, incoming.id);
  run.note(LOG.levelsUp(playerId, incoming.name, incoming.level), incoming.id);

  run.settle();
  // Two different sets of cards react, and the arriving card is not one of
  // them.
  //
  // [Enter] belongs to the card arriving: levelling up is how a Level 1 or 2
  // card gets onto the field, which is why so many of them read
  // "[Enter] / [Level up]".
  //
  // [Level up] belongs to the cards already in play — "when THIS character is
  // levelled up" is something that happens TO them, not to the one being
  // played. Firing it on the arriving card instead made BP01-001 ("return
  // this card to the Character Deck") bounce itself straight back off the
  // field the moment it was played.
  //
  // EVERY card under the new one answers, not just the one directly beneath.
  // The rules stack the pile face-up precisely because the lower levels keep
  // their skills, so a card two levels down is as much "this character" as
  // the one on top. Firing only on the covered card meant Shorekeeper's
  // BP01-009 ([Enter]/[Level up]) went quiet as soon as a second Level 2 was
  // played over the Level 2 that had covered it: 010 > 009 > 007 > 006 fired
  // 009 on the third step and never again.
  run.fireOn("enter", sourceForCharacter(incoming, playerId, zone));
  run.fireOn(
    "levelUp",
    beneath.flatMap((card) => sourceForCharacter(card, playerId, zone))
  );
  run.settle();
  advanceIfActionsSpent(run, playerId);
}

function switchLeader(run: Run, playerId: string, toCardId: string): void {
  if (run.state.phase === "action" && isRestricted(run.state, playerId, "noLeaderSwitch")) {
    run.reject("An effect stops you switching Leader this turn");
  }
  takeAction(run, playerId, "switch");
  const board = run.board(playerId);

  const index = board.back.findIndex((slot) => slot.card.id === toCardId);
  if (index < 0) run.reject(`${toCardId} is not a back character`);

  const incoming = board.back[index];
  const outgoing = board.leader;
  // The whole pile moves, not just the top card — a character switched to the
  // back keeps the levels they were played through.
  board.leader = { ...incoming, position: "leader" };
  if (outgoing) board.back[index] = { ...outgoing, position: "back" };
  else board.back.splice(index, 1);
  run.note(LOG.switchesLeader(playerId, incoming.card.name), incoming.card.id);

  // Only the two characters that changed places are "switched" — [Switch] reads
  // "when THIS character is switched", and a board-wide raise fired it on every
  // character in play, including the one that never moved and the opponent's.
  // Their new positions, not their old ones: the incoming card is the Leader now.
  run.fireOn("switch", [
    ...sourcesForSlot({ ...incoming, position: "leader" }, playerId),
    ...(outgoing ? sourcesForSlot({ ...outgoing, position: "back" }, playerId) : []),
  ]);
  run.settle();
  advanceIfActionsSpent(run, playerId);
}

function isRestricted(state: MatchState, playerId: string, flag: string): boolean {
  return (state.turnLog.flags[playerId] ?? []).includes(flag);
}

// --- Counter Phase ---------------------------------------------------------

/**
 * Leaves the Action Phase and opens the Counter Phase.
 *
 * The rules make the Counter Phase the turn player's to open: they decide
 * whether it happens at all, and cards go down starting with them. So this is
 * their move, and nobody else's — and it is separate from laying a card down
 * on purpose, so that the player who lays the first card is not also the one
 * deciding when the Action Phase ended.
 */
function toBattle(run: Run, playerId: string): void {
  if (run.state.phase !== "action") run.reject("The Action Phase is not running");
  if (playerId !== run.state.turnPlayerId) run.reject("It is not your turn");
  openCounterPhase(run);
}

/**
 * Leaves the Action Phase for the End Phase, skipping the clash entirely.
 *
 * The turn player's other exit: closing the Action Phase, they declare either
 * the Counter Phase or the End Phase. It is not the same as laying nothing down
 * — that happens INSIDE the Counter Phase and loses the clash. This never opens
 * the phase at all, so no [Counter] or [Judgement] skill fires on either side,
 * nobody takes damage, and there is nothing to combo from.
 *
 * It is also the only way the opponent's half of [Advantage] is ever satisfied:
 * "you won the previous clash, OR your opponent skipped the Counter Phase".
 */
function skipCounter(run: Run, playerId: string): void {
  if (run.state.phase !== "action") run.reject("The Action Phase is not running");
  if (playerId !== run.state.turnPlayerId) run.reject("It is not your turn");

  const other = opponentOf(run.state, playerId);
  // Booked for next turn like every other Advantage, so the player who was
  // skipped on does not gain it in the middle of the turn it happened.
  run.state.pendingAdvantageIds = other ? [other] : [];
  run.state.phase = "end";
  run.note(LOG.skipsCounterPhase(playerId));
  run.settle();
}

/**
 * Moves the board into the Counter Phase and raises the trigger that goes
 * with it. One place, because it happens three ways: the turn player calling
 * it, the engine closing a spent Action Phase, and the opening of a turn
 * where nothing is left to do.
 */
function openCounterPhase(run: Run): void {
  run.state.phase = "counter";
  run.note(LOG.battlePhase(run.state.turnPlayerId));
  run.fire("counterPhaseStart");
  run.settle();
}

/**
 * Closes the Action Phase once all three of its moves are spent.
 *
 * Charge, Level Up and Switch are once each per turn, so after the third
 * there is nothing left the phase can be used for and sitting in it is just
 * a click the player has to make for no reason.
 */
function advanceIfActionsSpent(run: Run, playerId: string): void {
  if (run.state.phase !== "action") return;
  if (run.board(playerId).actionsTakenThisTurn.length < MAX_ACTIONS_PER_TURN) return;
  openCounterPhase(run);
}

function commit(run: Run, playerId: string, cardId: string): void {
  // Only in the Counter Phase now. Committing used to be allowed during the
  // Action Phase as well, where it doubled as the way into this phase.
  if (run.state.phase !== "counter") {
    run.reject("Cards are committed in the Counter Phase");
  }
  if (run.state.facedown[playerId]) run.reject("You have already committed a card");

  const board = run.board(playerId);
  const index = board.hand.findIndex((card) => card.id === cardId);
  if (index < 0) run.reject(`${cardId} is not in hand`);

  const card = board.hand[index];
  const blocked = playBlocking(run.state, card, playerId);
  if (blocked) run.reject(blocked);
  // The cost is NOT paid here. A card put down face-down has not been played
  // yet — it is paid for when it is turned up, which is also when an ability
  // that changes its cost has had its say. Affordability is still checked
  // now, so a player cannot commit something they could never pay for.
  board.hand.splice(index, 1);
  run.state.facedown[playerId] = card;
  run.state.committed[playerId] = true;
  run.note(LOG.commits(playerId));
  noteWhenBothReady(run);
}

/**
 * Plays nothing this Counter Phase.
 *
 * The two sides of the table do NOT have the same right here.
 *
 * The turn player declared this phase, so they must lay a card down. They may
 * skip only when nothing in their hand can legally be played — and the rules
 * make them prove it by showing their hand to the opponent, which is why this
 * reveals it rather than just letting the move through.
 *
 * The non-turn player may always decline: laying nothing out concedes the
 * clash but costs no card.
 */
function passCounter(run: Run, playerId: string): void {
  if (run.state.phase !== "counter") {
    run.reject("There is no Counter Phase running");
  }
  if (run.state.committed[playerId]) run.reject("You have already chosen");

  if (playerId === run.state.turnPlayerId) {
    if (canCommitAnything(run.state, playerId)) {
      run.reject("The turn player must lay a card down when they have one they can play");
    }
    if (!run.state.revealedHands.includes(playerId)) {
      run.state.revealedHands.push(playerId);
    }
    run.note(LOG.showsHandToSkip(playerId));
  }

  run.state.facedown[playerId] = null;
  run.state.committed[playerId] = true;
  run.note(LOG.playsNothing(playerId));
  noteWhenBothReady(run);
}

function noteWhenBothReady(run: Run): void {
  if (Object.keys(run.state.boards).every((id) => run.state.committed[id])) {
    run.note(LOG.bothReady());
  }
}

/** Gives up. Not a rules move — a player deciding the game is over. */
function concede(run: Run, playerId: string): void {
  const other = opponentOf(run.state, playerId);
  run.state.winnerId = other ?? "draw";
  run.note(LOG.concedes(playerId, other));
}

/**
 * Turns both cards up and plays the clash out: [Enter], then the colour and
 * speed comparison, then damage, then [Judgement]. Ends in the Combo Step.
 */
function resolveCounter(run: Run): void {
  if (run.state.phase !== "counter") run.reject("There is nothing to reveal yet");

  const turnPlayer = run.state.turnPlayerId;
  const opponent = Object.keys(run.state.boards).find((id) => id !== turnPlayer);
  if (!opponent) run.reject("The match needs two players");

  if (!run.state.committed[turnPlayer] || !run.state.committed[opponent]) {
    run.reject("Both players must choose a card, or decline, first");
  }
  const mine = run.state.facedown[turnPlayer];
  const theirs = run.state.facedown[opponent];

  // Reveal: whatever was laid down moves into the Action Zones.
  run.state.facedown[turnPlayer] = null;
  run.state.facedown[opponent] = null;
  run.state.committed[turnPlayer] = false;
  run.state.committed[opponent] = false;
  run.state.actionZone[turnPlayer] = mine ? [mine] : [];
  run.state.actionZone[opponent] = theirs ? [theirs] : [];
  if (mine) run.state = recordCardPlayed(run.state, turnPlayer, mine);
  if (theirs) run.state = recordCardPlayed(run.state, opponent, theirs);
  // Turning a card up is what plays it, so this is where it gets paid for.
  if (mine) payOnReveal(run, mine, turnPlayer);
  if (theirs) payOnReveal(run, theirs, opponent);
  // One line per side rather than one for both: each gets to carry its own
  // card, which is what puts the art beside it in the log.
  run.note(LOG.reveals(turnPlayer, mine?.name ?? null), mine?.id);
  run.note(LOG.reveals(opponent, theirs?.name ?? null), theirs?.id);

  const revealed = [
    ...(mine ? sourceForCard(run.state, mine, turnPlayer) : []),
    ...(theirs ? sourceForCard(run.state, theirs, opponent) : []),
  ];
  run.settle();
  run.fireOn("enter", revealed);
  // The Counter Phase happens for both sides at once, so [Counter] is raised
  // for everyone. It comes after the reveal, not before, because its
  // abilities ask what you are countering WITH ("if you counter with a green
  // card"), which has no answer while both cards are still face-down.
  run.fire("counter");
  run.fire("battle");

  // With only one card on the table there is nothing to compare it against,
  // so it simply lands. With neither there is no clash at all.
  const result = unopposedOrClash(run, turnPlayer, mine, opponent, theirs);

  run.state.lastBattleWinnerId = result.winnerId;
  // Who holds [Advantage] next turn. The rule has two halves — "you won the
  // previous clash, OR your opponent skipped the Counter Phase" — and only the
  // first can be decided here: skipping the phase means never reaching this
  // function at all, and skipCounter() books that case itself. Laying no card
  // down is NOT skipping the phase; it loses the clash, and the winner is
  // already covered.
  run.state.pendingAdvantageIds = result.winnerId ? [result.winnerId] : [];
  run.state.lastBattle =
    mine || theirs
      ? {
          winnerId: result.winnerId,
          loserId: result.loserId,
          colorByPlayer: {
            ...(mine ? { [turnPlayer]: mine.color } : {}),
            ...(theirs ? { [opponent]: theirs.color } : {}),
          },
          cardIdByPlayer: {
            ...(mine ? { [turnPlayer]: mine.id } : {}),
            ...(theirs ? { [opponent]: theirs.id } : {}),
          },
        }
      : null;

  if (result.winnerId && result.loserId) {
    run.note(LOG.winsClash(result.winnerId, whyClause(result.why)));
    run.state.combo = result.combo
      ? {
          playerId: result.winnerId,
          unlimited: result.combo.unlimited,
          remaining: result.combo.unlimited ? Infinity : result.combo.count,
        }
      : null;
  } else {
    run.note(LOG.clashDraw());
    run.state.combo = null;
  }

  // "勝敗決定後、…判定スキルを発動させ、…ダメージを…与える" — the winner is
  // settled, then Judgment skills resolve, and only THEN does the damage
  // land. So an ability that changes the damage still has its say, and one
  // asking whether damage was dealt has to look at the win, not at Life.
  run.fire("judgement");

  if (result.winnerId && result.loserId) {
    const extra = damageTakenModifier(run.state, result.loserId);
    // Re-read the winning card's attack: a Judgment skill may just have
    // changed it.
    const winner = result.winnerId === turnPlayer ? mine : theirs;
    const base = winner ? comboDamage(run.state, winner, result.winnerId) : result.damage;
    const total = Math.max(0, base + extra);
    run.board(result.loserId).life -= total;
    run.state = recordDamage(run.state, result.loserId, total);
    // Name the card that did it: with abilities, the clash and follow-ups all
    // taking Life in the same phase, "takes 1" on its own leaves a player no
    // way to tell which of them it was.
    const source: LogLine | string = winner
      ? `${winner.name} [${winner.id}]`
      : { th: "การปะทะ", en: "the clash" };
    run.note(
      LOG.takesFrom(result.loserId, total, source, run.board(result.loserId).life),
      winner?.id
    );
  }
  run.state = expireModifiers(run.state, "battle");
  run.fire("counterPhaseEnd");
  run.settle();
  // A drawn clash ends the Counter Phase outright: there is no winner, so there
  // is no Combo Step to enter. Sitting in "combo" with no window was harmless in
  // play — nothing could be comboed — but it told the phase track the turn was
  // somewhere it was not.
  run.state.phase = result.winnerId ? "combo" : "end";
}

// --- Combo Step ------------------------------------------------------------

function playCombo(run: Run, playerId: string, cardId: string): void {
  if (run.state.phase !== "combo") run.reject("Combos are played in the Combo Step");

  const window = run.state.combo;
  if (!window || window.playerId !== playerId) run.reject("You did not win the clash");
  if (!window.unlimited && window.remaining <= 0) run.reject("No follow-ups left");
  if (isRestricted(run.state, playerId, "noCombo")) {
    run.reject("An effect stops you comboing this turn");
  }
  if (isRestricted(run.state, playerId, "noFollowUp")) {
    run.reject("An effect stops you using follow-up attacks this turn");
  }

  const zone = run.state.actionZone[playerId] ?? [];
  // A limited chain is limited by its own count, not by the table: a red win
  // grants an unlimited chain, and stopping it at five cards turned
  // "unlimited" into "five". Caps a CARD imposes are still enforced, in
  // playBlocking below.
  if (!window.unlimited && zone.length >= ACTION_ZONE_MAX_CARDS) {
    run.reject(`The Action Area holds at most ${ACTION_ZONE_MAX_CARDS} cards`);
  }

  const board = run.board(playerId);
  const index = board.hand.findIndex((card) => card.id === cardId);
  if (index < 0) run.reject(`${cardId} is not in hand`);

  const card = board.hand[index];
  // "赤色のアクションカード1枚を…出す事で連撃が可能" — a follow-up is always a
  // red card, whether the chain came from winning with red or from a card's
  // own Follow{x}.
  if (card.color !== "red") {
    run.reject(`${card.name} is not red — follow-up attacks are red cards only`);
  }
  const blocked = playBlocking(run.state, card, playerId);
  if (blocked) run.reject(blocked);
  payCost(board, costOf(run.state, card, playerId));
  board.hand.splice(index, 1);
  zone.push(card);
  run.state.actionZone[playerId] = zone;
  run.state = recordCardPlayed(run.state, playerId, card);
  // Spend the allowance on run.state.combo, NOT on the `window` captured at
  // the top: recordCardPlayed hands back a fresh clone, so that reference now
  // points at a discarded object and writing to it would go nowhere.
  const spent = run.state.combo;
  if (spent && !spent.unlimited) spent.remaining -= 1;
  run.note(LOG.combosInto(playerId, card.name), card.id);

  run.settle();
  run.fireOn("enter", sourceForCard(run.state, card, playerId));
  // [Battle] (our `counter`) asks only that the card was PLAYED in the Battle
  // phase, and a follow-up is played in it — so a card put down as a combo
  // fires its [Battle] skill just as it would have on the reveal. Only
  // [Judgement] is restricted to the one card that decided the clash.
  // Raised for this card alone: the board-wide [Battle] skills already had
  // their turn at the reveal and must not fire again per follow-up.
  run.fireOn("counter", sourceForCard(run.state, card, playerId));
  run.fireOn("combo", sourceForCard(run.state, card, playerId));

  // A follow-up attack lands on its own, outside the colour clash: there is
  // nothing to compare it against, so its attack goes straight through.
  const opponent = opponentOf(run.state, playerId);
  if (opponent) {
    const damage = Math.max(
      0,
      comboDamage(run.state, card, playerId) + damageTakenModifier(run.state, opponent)
    );
    if (damage > 0) {
      run.board(opponent).life -= damage;
      run.state = recordDamage(run.state, opponent, damage);
      run.note(
        LOG.takesFrom(opponent, damage, `${card.name} [${card.id}]`, run.board(opponent).life)
      );
    }
  }

  run.settle();
}

/**
 * Spends the Concerto cards a revealed action card costs.
 *
 * The cost is worked out here rather than at commit time, so an ability that
 * changed it in between — "[Advantage] this card costs 1 less" — is already
 * counted. A player who can no longer cover it pays what they have; the log
 * says so rather than the shortfall passing unnoticed.
 */
function payOnReveal(run: Run, card: ActionCard, playerId: string): void {
  const cost = costOf(run.state, card, playerId);
  if (cost <= 0) return;
  const board = run.board(playerId);
  const available = board.competitionArea.length;
  payCost(board, Math.min(cost, available));
  run.note(
    available >= cost
      ? LOG.pays(playerId, cost, card.name)
      : LOG.owes(playerId, cost, card.name, available),
    card.id
  );
}

/**
 * The result of the clash, allowing for a side that played nothing.
 *
 * Two cards is the normal colour-and-speed comparison. One card wins
 * unopposed and hits for its attack, with the combo its Follow{x} grants.
 * Neither is a non-event.
 */
function unopposedOrClash(
  run: Run,
  turnPlayer: string,
  mine: ActionCard | null,
  opponent: string,
  theirs: ActionCard | null
): CombatResult {
  if (mine && theirs) {
    // Each side is measured with the modifiers that actually reach ITS card,
    // which is not the same list when one of them is limited to "the first
    // {Normal attack} you play this turn".
    return resolveCombat(
      { playerId: turnPlayer, card: mine },
      { playerId: opponent, card: theirs },
      [
        ...qualifyingModifiers(run.state, mine, turnPlayer),
        ...qualifyingModifiers(run.state, theirs, opponent),
      ],
      comboLookupFromDb(),
      filterableFor
    );
  }
  const solo = mine ? { playerId: turnPlayer, card: mine } : theirs ? { playerId: opponent, card: theirs } : null;
  if (!solo) return { winnerId: null, loserId: null, damage: 0, combo: null, why: null };

  const loser = solo.playerId === turnPlayer ? opponent : turnPlayer;
  return {
    winnerId: solo.playerId,
    loserId: loser,
    damage: comboDamage(run.state, solo.card, solo.playerId),
    combo: comboLookupFromDb()(solo.card),
    why: { kind: "unopposed" },
  };
}

/**
 * How the clash was decided, for the log.
 *
 * A win is not always visible on the board: a 0-attack Dodge beats a red
 * card on colour alone, so the loser takes nothing and the only sign
 * anything happened is a [Judgement] skill firing. Saying why leaves nobody
 * wondering whether the engine got it wrong.
 */
function whyClause(why: CombatReason | null): LogLine {
  if (!why) return { th: "", en: "" };
  switch (why.kind) {
    case "color":
      return LOG.byColor(why.winner, why.loser);
    case "speed":
      return LOG.bySpeed(why.winner, why.loser);
    case "tie":
      return LOG.byTie();
    case "unopposed":
      return LOG.unopposed();
  }
}

/** A follow-up card's attack after modifiers — what it actually hits for. */
function comboDamage(state: MatchState, card: ActionCard, controllerId: string): number {
  return effectiveStats(
    { ...filterableFor(card), attack: card.damage, speed: card.speed, cost: card.cost },
    controllerId,
    qualifyingModifiers(state, card, controllerId)
  ).attack;
}

function passCombo(run: Run, playerId: string): void {
  if (run.state.phase !== "combo") run.reject("There is no Combo Step running");
  if (run.state.combo && run.state.combo.playerId !== playerId) {
    run.reject("You did not win the clash");
  }
  run.state.combo = null;
  run.state.phase = "end";
  run.note(LOG.endsCombo(playerId));
}

// --- End Phase -------------------------------------------------------------

function endTurn(run: Run, playerId: string): void {
  // The player holding the Combo window owns its last decision: they may
  // continue attacking, pass, or press End to finish it. This can be the
  // NON-turn player after winning the clash, so letting turnPlayer end it
  // would let the losing side spend somebody else's follow-up window.
  if (run.state.phase === "combo" && run.state.combo) {
    if (playerId !== run.state.combo.playerId) {
      run.reject("Only the combo player may end the Combo Step");
    }
  } else if (playerId !== run.state.turnPlayerId) {
    // No combo owner remains in the ordinary End Phase: turn ownership rules
    // take over as usual.
    run.reject("It is not your turn");
  }

  if (run.state.phase !== "end" && run.state.phase !== "combo") {
    run.reject("The turn is not finished yet");
  }

  run.state.phase = "end";

  run.fire("endTurn");

  // Every player's Action Area is emptied; only the TURN player discards down to
  // the hand limit. Applying the limit to both sides took cards off a player on
  // a turn that was not theirs.
  for (const id of Object.keys(run.state.boards)) {
    const before = run.board(id).hand.length;
    run.state = applyEndPhase(run.state, id, undefined, {
      discardToLimit: id === run.state.turnPlayerId,
    });
    const after = run.board(id).hand.length;
    if (after < before) run.note(LOG.discardsToLimit(id, HAND_LIMIT));
  }

  run.state = expireModifiers(run.state, "turn");
  run.state.combo = null;

  const opponent = opponentOf(run.state, run.state.turnPlayerId);
  if (opponent) run.state.turnPlayerId = opponent;
  run.state.turnNumber += 1;
  run.state.phase = "draw";
  run.note(LOG.turnStarts(run.state.turnNumber, run.state.turnPlayerId));

  run.settle();
}

// --- Small helpers ---------------------------------------------------------

/** The other player, or null in a state that somehow has only one. */
export function opponentOf(state: MatchState, playerId: string): string | null {
  return Object.keys(state.boards).find((id) => id !== playerId) ?? null;
}

/**
 * The view of the match one player is allowed to see: the opponent's hand,
 * deck and face-down card are emptied out, so the wire never carries them.
 * Use publicCounts for the numbers the UI still needs to show. The server
 * sends this, never the raw state.
 */
export function viewFor(state: MatchState, playerId: string): MatchState {
  const view = structuredClone(state);
  for (const [id, board] of Object.entries(view.boards)) {
    if (id === playerId) continue;
    // Backs, not nothing: the number of cards someone holds, the size of
    // their deck and whether they have committed for the Counter Phase are
    // all things you can see across a table, and the board draws them from
    // these arrays. Emptying them would hide public information.
    //
    // A hand an ability turned face-up stays visible to everyone.
    if (!view.revealedHands.includes(id)) {
      board.hand = board.hand.map((_, index) => hiddenActionCard(index));
    }
    board.actionDeck = board.actionDeck.map((_, index) => hiddenActionCard(index));
    if (view.facedown[id]) view.facedown[id] = hiddenActionCard(0);
  }
  return view;
}

/** How many cards each player is holding, for the opponent's side of the UI. */
export function publicCounts(state: MatchState, playerId: string): {
  hand: number;
  deck: number;
  facedown: boolean;
} {
  const board = state.boards[playerId];
  return {
    hand: board?.hand.length ?? 0,
    deck: board?.actionDeck.length ?? 0,
    facedown: Boolean(state.facedown[playerId]),
  };
}

/** Which back character may be levelled up or switched to right now. */
export function legalIntents(state: MatchState, playerId: string): MatchIntent["kind"][] {
  if (state.winnerId) return [];
  const board = state.boards[playerId];
  if (!board) return [];

  // The mulligan is not part of anybody's turn: both players answer it, in
  // whatever order they get to it, so it is checked before the turn gate.
  if (state.phase === "mulligan") {
    return state.mulliganDone[playerId] ? [] : ["mulligan"];
  }
  // Combo is the single phase whose owner may differ from turnPlayer. Check
  // it BEFORE the ordinary turn gate: a non-turn player can win the clash,
  // and still owns every decision that follows — including the exit when an
  // effect makes another follow-up illegal.
  if (state.phase === "combo") {
    if (state.combo) {
      if (state.combo.playerId !== playerId) return [];
      const canFollow =
        (state.combo.unlimited || state.combo.remaining > 0) &&
        !isRestricted(state, playerId, "noCombo") &&
        !isRestricted(state, playerId, "noFollowUp");
      // Do NOT hide both exits when a restriction applies. `noCombo` and
      // `noFollowUp` only forbid playing another card; their owner must still
      // be able to pass the window or press End, otherwise the phase has no
      // legal way out.
      return canFollow ? ["combo", "passCombo", "endTurn"] : ["passCombo", "endTurn"];
    }
    // A clash can reach this phase with no follow-up window at all. Then it
    // is merely the tail of the turn and the turn player ends it.
    return playerId === state.turnPlayerId ? ["endTurn"] : [];
  }

  if (playerId !== state.turnPlayerId) return [];

  // "mulligan" is already gone by here, handled above.
  switch (state.phase) {
    case "draw":
      return ["startTurn"];
    case "action": {
      // Laying a card down is no longer one of these: it belongs to the
      // Counter Phase, and "toBattle" is how this phase is left.
      // Both exits from the Action Phase: into the clash, or straight past it.
      const kinds: MatchIntent["kind"][] = ["toBattle", "skipCounter"];
      for (const kind of ["charge", "levelUp", "switch"] as const) {
        if (canTakeAction(board, kind).ok) kinds.push(kind);
      }
      return kinds;
    }
    case "counter": {
      // Revealing needs BOTH players to have chosen, and the other one may
      // still be thinking — offering it earlier only produces a rejection.
      const everyoneChose = Object.keys(state.boards).every((id) => state.committed[id]);
      if (everyoneChose) return ["resolveCounter"];
      if (state.committed[playerId]) return [];
      // This branch only ever answers for the turn player (see the guard at the
      // top), and they may not decline while they hold something playable.
      return canPassCounter(state, playerId) ? ["commit", "pass"] : ["commit"];
    }
    case "end":
      return ["endTurn"];
  }
}

/**
 * Whether this player still owes an opening-hand decision.
 *
 * Like canCommit(), and for the same reason: it is a move both players make,
 * so legalIntents() — which is written around the turn player — is not where
 * the UI should ask.
 */
export function canMulligan(state: MatchState, playerId: string): boolean {
  if (state.winnerId || state.phase !== "mulligan") return false;
  return Boolean(state.boards[playerId]) && !state.mulliganDone[playerId];
}

/**
 * Whether this player may still put a card face-down for the clash.
 *
 * Not something legalIntents() can answer: it reports the TURN player's
 * moves, and committing is the one thing both players do — the other side
 * lays a card out on your turn too. The guards are commit()'s own, so a card
 * this says yes to is one the engine will take (whether that particular card
 * can be paid for is whyUnplayable's question, per card).
 */
export function canCommit(state: MatchState, playerId: string): boolean {
  if (state.winnerId) return false;
  // Only once the Counter Phase is open. During the Action Phase there is
  // nothing to answer yet, on either side of the table.
  if (state.phase !== "counter") return false;
  if (state.facedown[playerId]) return false;
  return Boolean(state.boards[playerId]);
}

/**
 * Whether this player has any card they could actually put down: one in hand
 * they can pay for. False means their only move is to decline.
 */
export function canCommitAnything(state: MatchState, playerId: string): boolean {
  const board = state.boards[playerId];
  if (!board) return false;
  return board.hand.some((card) => playBlocking(state, card, playerId) === null);
}

/**
 * Whether this player may decline the clash.
 *
 * Not symmetric, and that is the rule rather than an oversight: the turn player
 * declared this phase and has to lay a card down, so they may only skip when
 * nothing in hand is playable (and passing then shows their hand, see
 * passCounter). The non-turn player may always decline.
 *
 * Exported so the UI hides the button instead of offering a move the engine
 * will refuse — the two must agree, so they read the same function.
 */
export function canPassCounter(state: MatchState, playerId: string): boolean {
  if (!canCommit(state, playerId) || state.committed[playerId]) return false;
  if (playerId !== state.turnPlayerId) return true;
  return !canCommitAnything(state, playerId);
}

/**
 * The Character Deck cards that may legally be played onto one character in
 * play, right now.
 *
 * Here rather than in the UI because it is the rule, not a presentation
 * choice: the ladder, the cost the hand has to cover, the cards only an
 * ability may put into play, and whether a Level Up is left this turn at
 * all. An empty list means the move is not on offer, and the engine checks
 * every one of these again when the intent actually arrives.
 */
export function levelUpOptions(
  state: MatchState,
  playerId: string,
  characterCardId: string
): CharacterCard[] {
  const board = state.boards[playerId];
  if (!board) return [];
  if (!legalIntents(state, playerId).includes("levelUp")) return [];
  const slot = [board.leader, ...board.back].find((entry) => entry?.card.id === characterCardId);
  if (!slot) return [];
  if (!canStackOnto(slot).ok) return [];
  return board.characterPool.filter(
    (card) => !isAbilityOnly(card.id) && canLevelUpOnto(slot.card, card, board).ok
  );
}

/**
 * Whether the Leader may be switched right now — there is someone in the
 * back to switch with, the turn's one action is still free, and no card has
 * shut switching off for the turn.
 */
export function canSwitchLeader(state: MatchState, playerId: string): boolean {
  const board = state.boards[playerId];
  if (!board || board.back.length === 0) return false;
  if (!legalIntents(state, playerId).includes("switch")) return false;
  return !(state.phase === "action" && isRestricted(state, playerId, "noLeaderSwitch"));
}

/** Why a card in hand cannot be played, for the UI to show on the card. */
export function whyUnplayable(
  state: MatchState,
  card: ActionCard,
  playerId: string
): string | null {
  return playBlocking(state, card, playerId);
}
