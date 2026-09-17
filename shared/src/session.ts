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
import { shuffle, starterFor } from "./decks";
import type { ResolvedEffect } from "./effects";
import type { MatchState } from "./game";
import { createMatch, step, viewFor, type MatchIntent } from "./match";
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
  manual: ResolvedEffect[];
  log: string[];
  error: string | null;
}

/**
 * Deals a fresh match between two picked characters.
 *
 * The seat ids are the engine's player ids, so nothing has to be translated
 * on the way to the client.
 */
export function dealMatch(matchId: string, picks: Record<Seat, string>, seed: number): MatchState {
  const [first, second] = SEATS;
  const mine = starterFor(picks[first]);
  const theirs = starterFor(picks[second]);
  return createMatch({
    matchId,
    startingPlayerId: first,
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

export class MatchSession {
  state: MatchState;
  question: OpenQuestion | null = null;
  manual: ResolvedEffect[] = [];
  log: string[] = [];
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

  static deal(matchId: string, picks: Record<Seat, string>, seed: number): MatchSession {
    return new MatchSession(dealMatch(matchId, picks, seed));
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

  private run(actor: Seat, intent: MatchIntent, answers: ChoiceAnswer[]): boolean {
    const result = step(this.state, actor, intent, answers);

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
      manual: this.manual,
      log: this.log,
      error: this.errors[seat] ?? null,
    };
  }
}
