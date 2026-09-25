// The bot, thinking ahead: what each move actually does, found by playing it.
//
// bot.ts prices cards by their numbers — colour, damage, speed, cost. That is
// all it can see, and it is blind to the part of a card that is written in
// words: the [Judgement] that draws two, the Leader Skill that makes every red
// card +2, the [Enter] that pulls a card back out of the trash. Pricing those
// by hand would mean a second copy of every card's text, which is the one
// thing bot.ts promises never to keep.
//
// So this file does not price them. It plays them. For each move worth
// considering it takes the board as the bot sees it, fills in what the bot
// cannot see with something plausible, plays the move through the real
// engine — `step`, the same function a real move goes through — and lets both
// sides carry on with bot.ts's policy through this turn and the opponent's
// reply. Then it looks at the board. Whatever the cards did on the way, their
// abilities included, is in that board: the Life lost, the cards drawn, the
// Concerto spent. Do that several times over with different guesses, and the
// move with the best average board is the move.
//
// That is also how it weighs racing against building up. A card spent on
// damage now and a card kept to block with — or a character that draws
// cards against one that hits harder — are the same question: which leaves
// the better board once the other side has answered. The reply turn is what
// makes a hand that was emptied for damage pay for it.
//
// **Still only the view.** The unseen cards are filled in from
// `foeCardPool` — the opponent's characters, their trash, what they have
// shown — never from the match. And the bot's own deck is shuffled before
// each guess: it knows which cards are in its deck, as any player does, but
// not which comes next, even though the view happens to hand it over in order.
//
// **Deterministic.** Every guess comes from a generator seeded off the view,
// so the same board always gets the same answer. That is what lets
// test-bot.ts change the opponent's hand behind the bot's back and check the
// answer does not move, and it keeps a reported game reproducible.

import { botAnswer, botIntents, foeCardPool, spareFirst } from "./bot";
import type { ChoiceAnswer, PendingChoice } from "./cardDef";
import { getCard } from "./cardDb";
import { cardsFor, toCharacterCard } from "./decks";
import {
  cloneData,
  isHiddenCard,
  type ActionCard,
  type CharacterInstance,
  type MatchState,
  type PlayerBoard,
} from "./game";
import {
  canChooseLeader,
  canCommit,
  canMulligan,
  canPassCounter,
  legalIntents,
  opponentOf,
  step,
  viewFor,
  whyUnplayable,
  type MatchIntent,
} from "./match";
import type { MatchSession } from "./session";
import type { Seat } from "./types";

// --- How hard it thinks, and what it wants ---------------------------------

/**
 * Every number the search runs on, in one place.
 *
 * An object rather than constants so `npm run bench:bot` can play two sets of
 * them against each other in one process — which is how these were chosen,
 * and how any change to them should be judged.
 */
export interface SearchTuning {
  /**
   * How much engine work one decision may spend, in steps — the engine's own
   * unit, about a fifth of a millisecond each. Counted rather than timed, so
   * the same board always gets the same amount of thought and so the same
   * answer, on a fast machine or a slow one.
   *
   * Spent in rounds: each round is one more guess at the hidden cards, played
   * against every candidate — the comparison is between moves, not between
   * lucky and unlucky deals. A cheap decision gets many rounds, an expensive
   * one few. It runs in the browser tab, and a decision that takes too long
   * is a frozen board.
   */
  budget: number;
  /** Rounds to play whatever the budget says. Fewer is noise. */
  minSamples: number;
  /** Rounds past which more guessing stops changing the answer. */
  maxSamples: number;
  /**
   * Drop the weaker half of the candidates as the rounds go on. 1 on, 0 off.
   * As strong as spreading the rounds evenly, measured, with a much shorter
   * worst case — which is what makes twelve candidates affordable.
   */
  halving: number;
  /**
   * Candidates beyond this are not searched; bot.ts's order decides among
   * them. More is not free: without halving, twelve spread the same budget
   * so thin that it lost to eight, 38–58.
   */
  maxCandidates: number;
  /**
   * How many turn ends a playout runs to. One is the turn the move is made
   * in: the clash it leads to, the combo after it. Two carries on through the
   * other player's reply, which is where a card kept back to block — or
   * spent so it cannot — shows what it was worth. Two beat one 44–16, and is
   * the single biggest thing in here.
   */
  horizon: number;
  /**
   * Play out the opening choices too — who leads, what to mulligan — rather
   * than leaving them to bot.ts. 1 on, 0 off. Off, because it measured no
   * better (93–99 over 192 games): the first two turns say little about a
   * Leader chosen for the whole game, and bot.ts's reading of the deck — whose
   * Leader Skill cards it holds — does as well for a fraction of the time.
   */
  opening: number;

  // The weights below are where the arena found no better: doubling the value
  // of a level, or raising a card in hand to a full point of Life, moved the
  // win rate by less than the noise over 96 games each.

  /** A card in hand, in Life. */
  hand: number;
  /** Hands past this are mostly discarded at the end of the turn anyway. */
  handCap: number;
  /** A charged card: one expensive card paid for, later. */
  concerto: number;
  /** Concerto past this is rarely all spent. */
  concertoCap: number;
  /** One level on a character in play: its abilities, for the rest of the game. */
  level: number;
  /** Going into the next turn holding [Advantage]. */
  advantage: number;
  /**
   * Life below `dangerLine` counts extra, by `danger` a point: the same two
   * points that are a scratch at 15 are the game at 2.
   */
  dangerLine: number;
  danger: number;
}

export const DEFAULT_TUNING: SearchTuning = {
  budget: 1000,
  minSamples: 2,
  maxSamples: 16,
  maxCandidates: 12,
  halving: 1,
  horizon: 2,
  opening: 0,
  hand: 0.6,
  handCap: 7,
  concerto: 0.4,
  concertoCap: 3,
  level: 1.2,
  advantage: 1,
  dangerLine: 6,
  danger: 0.5,
};

/** Moves one playout may take, per turn, before it is cut off where it stands. */
const PLAYOUT_LIMIT = 60;

/** Answers one move may need before it is given up on. */
const ANSWER_LIMIT = 12;

/** A won game, against which nothing else on the board matters. */
const WIN = 1000;

// --- What a board is worth -------------------------------------------------

function sideValue(state: MatchState, board: PlayerBoard, tuning: SearchTuning): number {
  const life = board.life - tuning.danger * Math.max(0, tuning.dangerLine - board.life);
  const levels = [board.leader, ...board.back].reduce((sum, slot) => sum + (slot?.card.level ?? 0), 0);
  const advantage =
    state.pendingAdvantageIds.includes(board.playerId) ||
    (state.phase !== "end" && state.advantageIds.includes(board.playerId))
      ? 1
      : 0;
  return (
    life +
    tuning.hand * Math.min(board.hand.length, tuning.handCap) +
    tuning.concerto * Math.min(board.competitionArea.length, tuning.concertoCap) +
    tuning.level * levels +
    tuning.advantage * advantage
  );
}

/** How good this board is for `seat`, in Life. */
function evaluate(state: MatchState, seat: Seat, tuning: SearchTuning): number {
  if (state.winnerId) {
    if (state.winnerId === seat) return WIN;
    return state.winnerId === "draw" ? 0 : -WIN;
  }
  const foe = opponentOf(state, seat);
  const mine = state.boards[seat];
  if (!mine) return 0;
  const theirs = foe ? state.boards[foe] : null;
  return sideValue(state, mine, tuning) - (theirs ? sideValue(state, theirs, tuning) : 0);
}

// --- Guessing what cannot be seen ------------------------------------------

/** A small seeded generator (mulberry32): a number in [0, 1). */
function generator(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A seed taken from what the bot can see and nothing else.
 *
 * The opponent's hidden cards are placeholders in the view, identical
 * whatever is really there, so hashing the whole view is safe — and it means
 * the same board is always searched with the same guesses.
 */
function seedOf(view: MatchState, seat: Seat): number {
  const text = `${seat}|${JSON.stringify(view)}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

function shuffled<T>(cards: T[], random: () => number): T[] {
  const out = [...cards];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * One guess at the whole board: the view, with every hidden card filled in.
 *
 * The opponent's hand, deck and face-down card are drawn from foeCardPool,
 * which only knows what is public. The bot's own deck is shuffled, since the
 * order of it is the one thing about its own cards it has no right to.
 */
function guess(view: MatchState, seat: Seat, random: () => number): MatchState {
  const state = cloneData(view);
  const mine = state.boards[seat];
  if (mine) mine.actionDeck = shuffled(mine.actionDeck, random);

  const foe = opponentOf(state, seat);
  const theirs = foe ? state.boards[foe] : null;
  if (!foe || !theirs) return state;

  const pool = foeCardPool(view, foe);
  const total = pool.reduce((sum, entry) => sum + entry.weight, 0);
  let made = 0;
  const draw = (): ActionCard => {
    let roll = random() * total;
    const entry = pool.find((candidate) => (roll -= candidate.weight) < 0) ?? pool[pool.length - 1];
    return { ...entry.card, uid: `${foe}-guess-${made++}` };
  };

  // Before the mulligan is over their three starters are face down too. Which
  // three is no secret — the rest of each character's cards are sitting in
  // their Character Deck — only which of them leads, so that is guessed.
  const slots = [theirs.leader, ...theirs.back].filter((slot): slot is CharacterInstance => slot !== null);
  if (slots.some((slot) => isHiddenCard(slot.card))) {
    const names = [...new Set(theirs.characterPool.map((card) => getCard(card.id)?.character).filter(Boolean))];
    const starters = shuffled(
      names.flatMap((name) => cardsFor(name!).characters.filter((def) => def.level === 0).slice(0, 1)),
      random
    ).map(toCharacterCard);
    slots.forEach((slot, index) => {
      if (isHiddenCard(slot.card) && starters[index]) slot.card = starters[index];
    });
  }

  theirs.hand = theirs.hand.map((card) => (isHiddenCard(card) ? draw() : card));
  theirs.actionDeck = theirs.actionDeck.map((card) => (isHiddenCard(card) ? draw() : card));

  // A card they have laid down has to be one they could pay for, or the
  // reveal would refuse it and the guess would be a board that cannot exist.
  const facedown = state.facedown[foe];
  if (facedown && isHiddenCard(facedown)) {
    let card = draw();
    for (let tries = 0; tries < 12 && whyUnplayable(state, card, foe) !== null; tries += 1) card = draw();
    state.facedown[foe] = card;
  }
  return state;
}

// --- Playing a move out ----------------------------------------------------

/** Engine steps played so far, by every search — what `budget` is counted in. */
let stepsTaken = 0;

/** A move as the engine replays it: who made it, what it was, answers so far. */
interface Move {
  actor: string;
  intent: MatchIntent;
  answers: ChoiceAnswer[];
}

/** Two questions are the same question if they come from the same card and offer the same things. */
function sameQuestion(a: PendingChoice, b: PendingChoice): boolean {
  return (
    a.cardId === b.cardId &&
    a.kind === b.kind &&
    a.options.map((option) => option.value).join("|") === b.options.map((option) => option.value).join("|")
  );
}

/**
 * Plays one move through the engine, answering any question it raises with
 * bot.ts's answer for whoever is asked.
 *
 * `expect` is for a move replayed from part-way, whose last answer is the one
 * being tried: the question the real match is waiting on. In a guessed world
 * the same move can ask something else there — the guess dealt the opponent
 * different cards — and then the answer being tried belongs to a different
 * question, so the guess is thrown out.
 *
 * Returns null when the engine refuses the move.
 */
function play(state: MatchState, move: Move, expect?: PendingChoice): MatchState | null {
  if (expect) {
    stepsTaken += 1;
    const before = step(state, move.actor, move.intent, move.answers.slice(0, -1));
    if (before.error || !before.pending || !sameQuestion(before.pending, expect)) return null;
  }
  const answers = [...move.answers];
  for (let asked = 0; asked < ANSWER_LIMIT; asked += 1) {
    stepsTaken += 1;
    const result = step(state, move.actor, move.intent, answers);
    if (result.error) return null;
    if (!result.pending) return result.state;
    answers.push(botAnswer(result.preview, result.pending.playerId as Seat, result.pending));
  }
  return null;
}

/**
 * The rest of the turn — or of `turns` turns — with bot.ts playing both sides.
 *
 * Ends when enough turns have passed, the game ends, or nobody can move. The
 * turn is the natural horizon because it is where a move's consequences land:
 * the clash it led to, the combo after it, the cards left in hand at the end.
 */
function playOut(state: MatchState, turns: number): MatchState {
  const until = state.turnNumber + turns;
  for (let moves = 0; moves < PLAYOUT_LIMIT * turns; moves += 1) {
    if (state.winnerId || state.turnNumber >= until) return state;
    const turnPlayer = state.turnPlayerId;
    const seats = [turnPlayer, ...Object.keys(state.boards).filter((id) => id !== turnPlayer)];
    let next: MatchState | null = null;
    for (const seat of seats) {
      for (const intent of botIntents(state, seat as Seat)) {
        next = play(state, { actor: seat, intent, answers: [] });
        if (next) break;
      }
      if (next) break;
    }
    if (!next) return state;
    state = next;
  }
  return state;
}

/**
 * Ranks moves by playing each one out against the same set of guesses.
 *
 * Returns the moves that could be played in at least one guess, best first.
 * The sort is stable, so moves that come out level keep the order they were
 * given in — bot.ts's order, which is the right tie-break.
 */
function rank<T>(
  view: MatchState,
  seat: Seat,
  options: T[],
  toMove: (option: T) => Move,
  tuning: SearchTuning,
  expect?: PendingChoice
): T[] {
  if (options.length <= 1) return options;
  const random = generator(seedOf(view, seat));
  const scored = options.map((option, order) => ({
    option,
    order,
    total: 0,
    counted: 0,
    value: -Infinity,
    // The round it was dropped in; Infinity while still in the running.
    dropped: Infinity,
  }));
  const mean = (entry: (typeof scored)[number]) => (entry.counted > 0 ? entry.total / entry.counted : -Infinity);

  let running = scored;
  const start = stepsTaken;
  let lastRound = 0;
  for (let round = 0; round < tuning.maxSamples; round += 1) {
    // Stop before a round that would run over, judging by the last one.
    const spent = stepsTaken - start;
    if (round >= tuning.minSamples && spent + lastRound > tuning.budget) break;
    const before = stepsTaken;
    const world = guess(view, seat, random);
    for (const entry of running) {
      const after = play(world, toMove(entry.option), expect);
      if (!after) continue;
      entry.total += evaluate(playOut(after, tuning.horizon), seat, tuning);
      entry.counted += 1;
    }
    lastRound = stepsTaken - before;

    // Every other round past the minimum, the weaker half is dropped and the
    // budget goes on telling the stronger ones apart. A few guesses are
    // enough to see a move is poor, and not nearly enough to see which of two
    // good ones is better — spreading the same guesses thinly over every
    // candidate is how a lucky bad move wins.
    if (tuning.halving && round + 1 >= tuning.minSamples && (round + 1) % 2 === 0 && running.length > 2) {
      const ordered = [...running].sort((x, y) => mean(y) - mean(x) || x.order - y.order);
      const keep = Math.max(2, Math.ceil(ordered.length / 2));
      for (const entry of ordered.slice(keep)) entry.dropped = round;
      running = ordered.slice(0, keep);
    }
  }
  for (const entry of scored) entry.value = mean(entry);
  return scored
    .filter((entry) => entry.value > -Infinity)
    .sort((a, b) => b.dropped - a.dropped || b.value - a.value || a.order - b.order)
    .map((entry) => entry.option);
}

// --- What is worth considering ---------------------------------------------

/** One entry per distinct move or answer: copies of a card are the same move. */
function unique<T>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = JSON.stringify(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * The moves worth playing out right now, or null where there is nothing to
 * decide — a phase with one way forward, or one bot.ts already handles.
 *
 * Wider than bot.ts's own list on purpose: that list is what bot.ts thinks,
 * and the point of searching is to find where it thinks wrong. So every card
 * that could be laid down is a candidate, not just the ones it rates, and
 * every card that could be charged, not just the one it would spare.
 */
function candidates(
  view: MatchState,
  seat: Seat,
  preferred: MatchIntent[],
  tuning: SearchTuning
): MatchIntent[] | null {
  const board = view.boards[seat];
  if (!board || view.winnerId) return null;
  const playable = board.hand.filter((card) => whyUnplayable(view, card, seat) === null);

  // Who leads: each of the three starters, played out into the first turns.
  if (canChooseLeader(view, seat)) {
    if (!tuning.opening) return null;
    return unique([
      ...preferred,
      ...[board.leader, ...board.back].flatMap((slot): MatchIntent[] =>
        slot ? [{ kind: "chooseLeader", leaderId: slot.card.id }] : []
      ),
    ]);
  }

  // The mulligan: bot.ts's pick, and putting back none to three of the
  // weakest cards — played out, a fresh draw from this deck against the hand.
  if (canMulligan(view, seat)) {
    if (!tuning.opening) return null;
    const weakest = spareFirst(view, seat, board.hand);
    return unique([
      ...preferred,
      ...[0, 1, 2, 3].map((count): MatchIntent => ({
        kind: "mulligan",
        cardIds: weakest.slice(0, count).map((card) => card.id),
      })),
    ]);
  }

  if (canCommit(view, seat) && !view.committed[seat]) {
    return unique([
      ...preferred,
      ...playable.map((card): MatchIntent => ({ kind: "commit", cardId: card.id })),
      ...(canPassCounter(view, seat) ? [{ kind: "pass" } as const] : []),
    ]);
  }

  const kinds = new Set(legalIntents(view, seat));
  if (view.phase === "action" && kinds.size > 0) {
    const out: MatchIntent[] = [...preferred];
    if (kinds.has("charge") && board.hand.length > 1) {
      for (const card of board.hand) out.push({ kind: "charge", cardIds: [card.id] });
    }
    if (kinds.has("switch")) {
      for (const slot of board.back) out.push({ kind: "switch", toCardId: slot.card.id });
    }
    if (kinds.has("toBattle")) out.push({ kind: "toBattle" });
    if (kinds.has("skipCounter")) out.push({ kind: "skipCounter" });
    return unique(out);
  }

  if (view.phase === "combo" && kinds.has("combo")) {
    return unique([
      ...preferred,
      ...playable.map((card): MatchIntent => ({ kind: "combo", cardId: card.id })),
      { kind: kinds.has("passCombo") ? "passCombo" : "endTurn" },
    ]);
  }
  return null;
}

// --- The two entry points --------------------------------------------------

/**
 * Everything the bot is willing to do right now, best first — bot.ts's list,
 * reordered by playing the candidates out.
 *
 * Takes the view, like everything the bot decides on. What was not searched
 * keeps bot.ts's order behind what was, so the list still ends in the moves
 * the phase cannot refuse.
 */
export function botChoose(view: MatchState, seat: Seat, tuning: SearchTuning = DEFAULT_TUNING): MatchIntent[] {
  const preferred = botIntents(view, seat);
  const options = candidates(view, seat, preferred, tuning);
  if (!options || options.length <= 1) return preferred;
  const ranked = rank(
    view,
    seat,
    options.slice(0, tuning.maxCandidates),
    (intent) => ({ actor: seat, intent, answers: [] }),
    tuning
  );
  return unique([...ranked, ...preferred]);
}

/**
 * The answers worth trying for a card's question, bot.ts's own first.
 *
 * One card from a list: every card on offer, copies counted once, and "none"
 * where none is allowed. Several at once has too many answers to play every
 * one out, so it gets bot.ts's pick, the fewest the card allows of that
 * pick, and the same number from the other end of the list — the same
 * judgement read the other way, for the times bot.ts has the direction
 * wrong.
 */
function answerCandidates(choice: PendingChoice, fallback: ChoiceAnswer): ChoiceAnswer[] {
  if (choice.kind === "confirm" || choice.options.length === 0) return unique([fallback, true, false]);
  if (choice.max <= 1) {
    const seen = new Set<string>();
    const out: ChoiceAnswer[] = [fallback];
    for (const option of choice.options) {
      const key = option.cardId ?? option.value;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(option.value);
    }
    if (choice.min === 0) out.push([]);
    return unique(out);
  }
  const picked = Array.isArray(fallback) ? fallback : [String(fallback)];
  const others = choice.options.map((option) => option.value).filter((value) => !picked.includes(value));
  const out: ChoiceAnswer[] = [picked, picked.slice(0, Math.max(choice.min, 0))];
  if (others.length >= Math.max(choice.min, picked.length > 0 ? 1 : 0)) {
    out.push(others.slice(-Math.max(picked.length, choice.min)));
  }
  return unique(out).filter(
    (answer) => Array.isArray(answer) && answer.length >= choice.min && answer.length <= choice.max
  );
}

/**
 * Answers a card's question by playing each answer out.
 *
 * Only for the bot's own moves. The move being replayed is the whole of what
 * the search needs, and when it is the opponent's move it can name a card
 * the bot has no right to know — the one they laid face-down, say. So a
 * question raised by the opponent's move gets bot.ts's answer instead.
 */
function searchAnswer(
  session: MatchSession,
  seat: Seat,
  choice: PendingChoice,
  fallback: ChoiceAnswer,
  tuning: SearchTuning
): ChoiceAnswer {
  const open = session.question;
  if (!open || open.actor !== seat) return fallback;
  const answers = answerCandidates(choice, fallback);
  if (answers.length <= 1) return fallback;

  // The board from before the move, as the bot is allowed to see it. The
  // question is replayed from there, answers and all.
  const view = viewFor(session.state, seat);
  const ranked = rank(
    view,
    seat,
    answers.slice(0, tuning.maxCandidates),
    (answer) => ({ actor: seat, intent: open.intent, answers: [...open.answers, answer] }),
    tuning,
    choice
  );
  return ranked[0] ?? fallback;
}

/** How a bot seat plays. */
export interface BotOptions {
  /**
   * Play moves out before choosing them. On by default; off leaves bot.ts's
   * pricing to decide alone — quicker, and weaker.
   */
  search?: boolean;
  /** Overrides for the search's numbers. For the arena; players get the defaults. */
  tuning?: Partial<SearchTuning>;
}

/**
 * Plays one move for the bot, through the same session a person moves
 * through.
 *
 * This is the one place the information boundary is actually drawn:
 * `updateFor(seat)` is the filtered state the server would send a networked
 * player, and it is the ONLY board handed to the policy. Everything else
 * here is the referee's side of the table — applying a move, finding out
 * whether the engine took it.
 *
 * Returns false when there was nothing to do, or when nothing the bot
 * proposed was accepted; a caller driving this in a loop should treat a run
 * of those as a bug rather than spinning on it.
 */
export function botStep(session: MatchSession, seat: Seat, options: BotOptions = {}): boolean {
  const search = options.search ?? true;
  const tuning = { ...DEFAULT_TUNING, ...options.tuning };
  const update = session.updateFor(seat);
  // A question put to the other player. Nothing may move until they answer.
  if (update.askingSeat && update.askingSeat !== seat) return false;
  if (update.pending) {
    const fallback = botAnswer(update.view, seat, update.pending);
    const answer = search ? searchAnswer(session, seat, update.pending, fallback, tuning) : fallback;
    return session.answer(seat, answer) || (answer !== fallback && session.answer(seat, fallback));
  }
  const intents = search ? botChoose(update.view, seat, tuning) : botIntents(update.view, seat);
  for (const intent of intents) {
    if (session.apply(seat, intent)) return true;
  }
  return false;
}
