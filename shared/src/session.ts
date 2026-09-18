// One live match, and the bookkeeping around the engine that a server needs.
//
// `step` is a pure function: it takes a state and gives one back, and when an
// effect needs a decision it hands back a question with the state UNCHANGED,
// expecting to be called again with the answer appended. Someone has to hold
// the half-finished move in the meantime, decide who is allowed to speak, and
// hand each player their own filtered view. That someone is this file.
//
// It lives in `shared` rather than in `server` because it is the same job on
// both sides of the wire, and because it can be tested here with the rest of
// the engine.

import type { ChoiceAnswer, PendingChoice } from "./cardDef";
import { deckToSetup, type DeckList } from "./deckList";
import { shuffle, starterFor } from "./decks";
import type { ResolvedEffect } from "./effects";
import type { MatchState } from "./game";
import { LOG, type LogLine } from "./log";
import { createMatch, step, viewFor, type MatchIntent, type StepResult } from "./match";
import type { Seat } from "./types";
import { SEATS } from "./types";

/** How many log lines to keep. Older ones have scrolled out of reach anyway. */
const LOG_LIMIT = 300;

/**
 * Moves that belong to the turn player alone.
 *
 * Most intents already carry the player and the engine checks them, but
 * `startTurn` and `resolveCounter` act on the board as a whole and never look
 * at who asked — over a socket that would let either player drive the other's
 * turn. Authorisation is this layer's job: the engine stays a rules function.
 */
const TURN_PLAYER_ONLY: MatchIntent["kind"][] = [
  "startTurn",
  "charge",
  "levelUp",
  "switch",
  "toBattle",
  "resolveCounter",
  "endTurn",
];

/** A move that stopped on a question, kept so the answer can replay it. */
export interface OpenQuestion {
  /** Whose move opened it — the one replayed, which is not always who is asked. */
  actor: Seat;
  intent: MatchIntent;
  answers: ChoiceAnswer[];
  choice: PendingChoice;
  /** The half-applied board, for the asked player to look at while deciding. */
  preview: MatchState;
}

/** Everything one seat is allowed to know right now. */
export interface SeatUpdate {
  view: MatchState;
  pending: PendingChoice | null;
  askingSeat: Seat | null;
  /**
   * Whose move is waiting on that answer. Only they may abandon it, and
   * without knowing who they are the client cannot offer the way out — which
   * is how a question nobody could answer became a board nobody could use.
   */
  actorSeat: Seat | null;
  manual: ResolvedEffect[];
  log: LogLine[];
  error: string | null;
}

/** How a deal may be steered away from its defaults. */
export interface DealOptions {
  /**
   * Who takes turn 1. Drawn from the seed when left out, which is what a
   * real match does — nobody gets the first turn for sitting down first.
   */
  startingPlayerId?: Seat;
  /** Deal straight into turn 1, skipping the opening mulligan. For tests. */
  skipMulligan?: boolean;
}

/**
 * Which seat opens, decided by the deal's own seed.
 *
 * Not Math.random: the seed is what makes a deal reproducible, and the coin
 * toss has to travel with it or replaying a match from its seed would deal
 * the same cards to the other player's turn.
 */
export function firstSeatFor(matchId: string, seed: number): Seat {
  let hash = (seed ^ 0x811c9dc5) >>> 0;
  for (let i = 0; i < matchId.length; i += 1) {
    hash ^= matchId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  // The low bit of an FNV hash is the weakest part of it, so mix the high
  // bits down before taking a coin toss off the bottom. Back to unsigned
  // after the xor: `^=` yields a SIGNED 32-bit int, and a negative remainder
  // indexes off the front of SEATS.
  hash = (hash ^ (hash >>> 16)) >>> 0;
  return SEATS[hash % SEATS.length];
}

/**
 * Deals a fresh match from the two players' deck lists.
 *
 * The seat ids are the engine's player ids, so nothing has to be translated
 * on the way to the client. Who goes first is a coin toss off the seed, and
 * both players open on the mulligan — see MatchIntent's "mulligan".
 */
export function dealMatch(
  matchId: string,
  decks: Record<Seat, DeckList>,
  seed: number,
  options: DealOptions = {}
): MatchState {
  const [first, second] = SEATS;
  const mine = deckToSetup(decks[first]);
  const theirs = deckToSetup(decks[second]);
  return createMatch({
    matchId,
    startingPlayerId: options.startingPlayerId ?? firstSeatFor(matchId, seed),
    skipMulligan: options.skipMulligan,
    players: [
      { playerId: first, characterDeck: mine.characterDeck, actionDeck: shuffle(mine.actionDeck, seed) },
      {
        playerId: second,
        characterDeck: theirs.characterDeck,
        // A different seed, or both players draw the same opening hand.
        actionDeck: shuffle(theirs.actionDeck, seed + 7919),
      },
    ],
  });
}

/**
 * A ready-made deck around one character, for the hotseat screen and tests —
 * anywhere a real deck list would only be ceremony.
 */
export function starterDeck(character: string): DeckList {
  const starter = starterFor(character);
  const cards: Record<string, number> = {};
  for (const card of starter.actionDeck) cards[card.id] = (cards[card.id] ?? 0) + 1;
  return { id: `starter-${character}`, name: character, characters: starter.characters, cards };
}

export class MatchSession {
  state: MatchState;
  question: OpenQuestion | null = null;
  manual: ResolvedEffect[] = [];
  log: LogLine[] = [];
  /** The last refusal per seat, shown only to the player who earned it. */
  private errors: Partial<Record<Seat, string>> = {};
  /**
   * The most recent refusal, whoever earned it — for a shared screen, where
   * there is only one person clicking and only one place to show it.
   */
  lastError: string | null = null;

  constructor(state: MatchState) {
    this.state = state;
  }

  static deal(
    matchId: string,
    decks: Record<Seat, DeckList>,
    seed: number,
    options: DealOptions = {}
  ): MatchSession {
    const session = new MatchSession(dealMatch(matchId, decks, seed, options));
    // The coin toss is the first thing that happened in this match, and the
    // board alone does not say it — turn 1 simply belongs to somebody.
    session.log = [LOG.goesFirst(session.state.startingPlayerId)];
    return session;
  }

  get winnerId(): string | null {
    return this.state.winnerId;
  }

  /**
   * The board to draw, unfiltered: the half-applied one while a question is
   * open, otherwise the committed one. Only safe to show someone who is
   * allowed to see both hands — over a socket, use updateFor().
   */
  get board(): MatchState {
    return this.question?.preview ?? this.state;
  }

  errorFor(seat: Seat): string | null {
    return this.errors[seat] ?? null;
  }

  /** Plays a move on behalf of a seat. Returns false if it was refused. */
  apply(seat: Seat, intent: MatchIntent): boolean {
    delete this.errors[seat];
    this.lastError = null;

    if (this.question) {
      return this.refuse(seat, "There is a question waiting to be answered");
    }
    if (TURN_PLAYER_ONLY.includes(intent.kind) && seat !== this.state.turnPlayerId) {
      return this.refuse(seat, "It is not your turn");
    }
    return this.run(seat, intent, []);
  }

  /** Answers the open question. Only the player it was put to may answer. */
  answer(seat: Seat, choice: ChoiceAnswer): boolean {
    const open = this.question;
    if (!open) return false;
    if (open.choice.playerId !== seat) {
      return this.refuse(seat, "That question is not yours to answer");
    }
    delete this.errors[seat];
    this.lastError = null;
    return this.run(open.actor, open.intent, [...open.answers, choice]);
  }

  /**
   * Abandons an open question, dropping the whole move with it.
   *
   * Only the player who made the move can do this: the one being asked is
   * being asked precisely because someone else's card said so.
   */
  cancel(seat: Seat): boolean {
    if (!this.question || this.question.actor !== seat) return false;
    this.question = null;
    return true;
  }

  /**
   * Ends the match right now in the other seat's favour — a player leaving
   * the room, or gone long enough to be given up on.
   *
   * A voluntary concession goes through apply(), which refuses every move,
   * concede included, while a question is open — right for a player who is
   * still there to answer it first. This is for when that assumption no
   * longer holds: there may be nobody left to ever answer, so it clears the
   * question rather than waiting on it.
   */
  forfeit(seat: Seat): void {
    if (this.state.winnerId) return;
    const other = SEATS.find((s) => s !== seat) ?? null;
    this.question = null;
    this.state.winnerId = other ?? "draw";
    this.log = [...this.log, LOG.leftMatch(seat, other)].slice(-LOG_LIMIT);
  }

  private run(actor: Seat, intent: MatchIntent, answers: ChoiceAnswer[]): boolean {
    let result: StepResult;
    try {
      result = step(this.state, actor, intent, answers);
    } catch (error) {
      // A card effect that throws is a bug, but it must not be a bug that
      // ends the match: unhandled, it takes the socket handler with it, the
      // server never sends an update, and both players are left staring at a
      // dialog whose buttons do nothing. Treat it like any other refusal —
      // the board is untouched, the question is dropped, and whoever was
      // moving can try something else.
      this.question = null;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`step failed (${intent.kind} by ${actor}):`, error);
      return this.refuse(actor, `เกิดข้อผิดพลาดภายในเกม: ${message}`);
    }

    if (result.error) {
      // Illegal move: say so to whoever made it and leave the board alone.
      this.question = null;
      return this.refuse(actor, result.error);
    }

    if (result.pending) {
      // Hold the move and the answers so far. `state` has not moved, so the
      // next answer replays the whole thing from exactly where it is now.
      this.question = {
        actor,
        intent,
        answers,
        choice: result.pending,
        preview: result.preview,
      };
      return true;
    }

    this.state = result.state;
    this.question = null;
    this.manual = result.manual;
    if (result.log.length > 0) {
      this.log = [...this.log, ...result.log].slice(-LOG_LIMIT);
    }
    return true;
  }

  private refuse(seat: Seat, message: string): false {
    this.errors[seat] = message;
    this.lastError = message;
    return false;
  }

  updateFor(seat: Seat): SeatUpdate {
    const open = this.question;
    const asked = open ? (open.choice.playerId as Seat) : null;
    // The preview is a move that has not landed yet: only the player who has
    // to decide sees it. Everyone else keeps the committed board until the
    // answer comes back, so nothing is shown that could still be cancelled.
    const board = open && asked === seat ? open.preview : this.state;
    return {
      view: viewFor(board, seat),
      pending: asked === seat ? open!.choice : null,
      askingSeat: asked,
      actorSeat: open?.actor ?? null,
      manual: this.manual,
      log: this.log,
      error: this.errors[seat] ?? null,
    };
  }
}
