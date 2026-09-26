// The lesson runner: a real match, played through the real engine, with a
// script deciding what happens next.
//
// Nothing here bends a rule. The board is an ordinary MatchState (dealt in a
// known order instead of shuffled), every move goes through MatchSession, and
// the opponent's moves are ordinary moves made from its seat. What the script
// adds is only WHICH move comes next:
//
//   - the player's moves are checked against the open step, and anything the
//     step is not asking for is refused — so the lesson cannot be walked off
//     its path by a stray click;
//   - the opponent plays exactly the cards the lesson needs it to, instead of
//     thinking for itself;
//   - a step that is there to be read holds the board still until the player
//     presses Next, so the turn does not run on underneath the explanation.
//
// Pure TypeScript, no React: the hook (useTutorialMatch) puts it on a timer,
// and a test can drive it without a browser.

import {
  LOG,
  MatchSession,
  botAnswer,
  canCommit,
  legalIntents,
  type ActionCard,
  type CardColor,
  type ChoiceAnswer,
  type MatchIntent,
  type MatchState,
  type Seat,
} from "@wuwatcg/shared";
import { nothingLeftToDo, turnEnder } from "../game/turnFlow";

/** Lesson text is written in both languages side by side, like the log's. */
export interface Text {
  th: string;
  en: string;
}

/** The player's seat. The scripted opponent takes the other one. */
export const PLAYER: Seat = "p1";
export const FOE: Seat = "p2";

/**
 * A move the step is waiting for. `card` names a printed card id: the card
 * laid down (commit, combo), charged (charge), levelled up WITH (levelUp) or
 * switched in (switch). `color` asks for any card of that colour instead.
 */
export interface MoveSpec {
  kind: MatchIntent["kind"];
  card?: string;
  color?: CardColor;
}

/** One of the opponent's scripted moves. */
export type FoeMove =
  | { kind: "toBattle" }
  | { kind: "skipCounter" }
  | { kind: "commit"; card: string };

/** What sits above a step's text. */
export type GuideFigure =
  | { kind: "triangle" }
  | { kind: "cards"; cards: string[]; vs?: boolean }
  | { kind: "summary" }
  | { kind: "table"; rows: [Text, Text][] };

export interface GuideStep {
  id: string;
  title: Text;
  body: Text;
  /** CSS selectors for what to ring on the board. */
  highlight?: string[];
  figure?: GuideFigure;
  /**
   * How long to keep the step out of sight after it opens, so a cut-in
   * (the clash reveal) is over before the explanation of it appears.
   */
  delayMs?: number;
  /**
   * How the step ends:
   *   next  — it is there to be read. The board holds until Next is pressed.
   *   move  — the player has to make this move; anything else is refused.
   *   until — it ends by itself once the board gets there (the opponent
   *           moving, the cards being turned up).
   */
  advance: { next: true } | { move: MoveSpec } | { until: (state: MatchState) => boolean };
  /** Further moves the player may make while the step is open, without ending it. */
  allow?: MoveSpec[];
  /** The opponent's moves, made in order as soon as each is legal. */
  foe?: FoeMove[];
}

export interface Lesson {
  id: string;
  title: Text;
  blurb: Text;
  /** The board the lesson opens on. */
  setup: () => MatchState;
  steps: GuideStep[];
}

/**
 * Moves that make themselves: PlayGame presses them from the player's seat
 * whenever they are the only thing left to do, and the director presses them
 * from the opponent's. Allowed whenever the board is not being held.
 */
function isHousekeeping(state: MatchState, intent: MatchIntent): boolean {
  if (intent.kind === "startTurn" || intent.kind === "resolveCounter") return true;
  return intent.kind === "endTurn" && nothingLeftToDo(state);
}

function handCard(state: MatchState, seat: Seat, cardId: string): ActionCard | undefined {
  return state.boards[seat]?.hand.find((card) => card.id === cardId);
}

/** The card a move names, where it names one. */
function cardOf(intent: MatchIntent): string | null {
  switch (intent.kind) {
    case "commit":
    case "combo":
      return intent.cardId;
    case "charge":
      return intent.cardIds.length === 1 ? intent.cardIds[0] : null;
    case "levelUp":
      return intent.characterId;
    case "switch":
      return intent.toCardId;
    default:
      return null;
  }
}

function matches(spec: MoveSpec, intent: MatchIntent, state: MatchState): boolean {
  if (spec.kind !== intent.kind) return false;
  const card = cardOf(intent);
  if (spec.card && card !== spec.card) return false;
  if (spec.color && (!card || handCard(state, PLAYER, card)?.color !== spec.color)) return false;
  return true;
}

export class TutorialDirector {
  readonly lesson: Lesson;
  readonly session: MatchSession;
  /** The open step; `steps.length` once the lesson is over. */
  at = 0;
  /** How many of the open step's scripted opponent moves have been made. */
  private foeMade = 0;

  constructor(lesson: Lesson) {
    this.lesson = lesson;
    this.session = new MatchSession(lesson.setup());
    this.session.log = [LOG.goesFirst(this.session.state.startingPlayerId)];
  }

  get step(): GuideStep | null {
    return this.lesson.steps[this.at] ?? null;
  }

  get finished(): boolean {
    return this.at >= this.lesson.steps.length;
  }

  /** True while the board is being held for the player to read. */
  get holding(): boolean {
    const step = this.step;
    return !step || "next" in step.advance;
  }

  /**
   * A move from the player's seat. Returns false, and leaves the board alone,
   * when it is not what the lesson is asking for.
   */
  play(intent: MatchIntent): boolean {
    const step = this.step;
    if (!step || this.holding) return false;
    const state = this.session.state;

    const wanted = "move" in step.advance && matches(step.advance.move, intent, state);
    const extra = step.allow?.some((spec) => matches(spec, intent, state)) ?? false;
    if (!wanted && !extra && !isHousekeeping(state, intent)) return false;

    if (!this.session.apply(PLAYER, intent)) return false;
    if (wanted) this.advance();
    this.settle();
    return true;
  }

  answer(choice: ChoiceAnswer): boolean {
    const ok = this.session.answer(PLAYER, choice);
    if (ok) this.settle();
    return ok;
  }

  /** Next, on a step that is there to be read. */
  next(): void {
    if (!this.holding || this.finished) return;
    this.advance();
    this.settle();
  }

  /**
   * One move the lesson makes by itself: the opponent's next scripted move,
   * its answer to a question, or the turn housekeeping on its side. Returns
   * false when there is nothing to do until the player acts. Called on a
   * timer, one move at a time, so each can be seen happening.
   */
  tick(): boolean {
    const session = this.session;
    const open = session.question;
    if (open) {
      if (open.choice.playerId !== FOE) return false;
      // "You may..." — the opponent declines. Its abilities are not what the
      // lesson is about, and saying yes would draw cards off the top of a
      // deck the script has put in order.
      const reply =
        open.choice.kind === "confirm"
          ? false
          : botAnswer(session.updateFor(FOE).view, FOE, open.choice);
      session.answer(FOE, reply);
      this.settle();
      return true;
    }
    if (this.holding) return false;

    const state = session.state;
    if (state.winnerId) return false;
    const scripted = this.step?.foe?.[this.foeMade];
    if (scripted && this.ready(scripted, state)) {
      const intent: MatchIntent =
        scripted.kind === "commit" ? { kind: "commit", cardId: scripted.card } : { kind: scripted.kind };
      if (session.apply(FOE, intent)) {
        this.foeMade += 1;
        this.settle();
        return true;
      }
    }

    const housekeeping = this.foeHousekeeping(state, Boolean(scripted));
    if (housekeeping && session.apply(FOE, housekeeping)) {
      this.settle();
      return true;
    }
    return false;
  }

  /** Whether the director has a move of its own to make right now. */
  get busy(): boolean {
    const open = this.session.question;
    if (open) return open.choice.playerId === FOE;
    if (this.holding || this.session.state.winnerId) return false;
    const scripted = this.step?.foe?.[this.foeMade];
    return (
      (Boolean(scripted) && this.ready(scripted!, this.session.state)) ||
      this.foeHousekeeping(this.session.state, Boolean(scripted)) !== null
    );
  }

  private ready(move: FoeMove, state: MatchState): boolean {
    if (move.kind === "commit") {
      return canCommit(state, FOE) && Boolean(handCard(state, FOE, move.card));
    }
    return legalIntents(state, FOE).includes(move.kind);
  }

  /** The opponent's side of the moves PlayGame makes for the player. */
  private foeHousekeeping(state: MatchState, scriptPending: boolean): MatchIntent | null {
    if (state.turnPlayerId === FOE) {
      if (state.phase === "draw") return { kind: "startTurn" };
      if (state.phase === "counter" && legalIntents(state, FOE).includes("resolveCounter")) {
        return { kind: "resolveCounter" };
      }
    }
    if (turnEnder(state) !== FOE) return null;
    if (nothingLeftToDo(state)) return { kind: "endTurn" };
    // A won clash with follow-ups open: the opponent only follows up when the
    // script says so, and otherwise closes the window.
    if (state.phase === "combo" && state.combo?.playerId === FOE && !scriptPending) {
      return { kind: "endTurn" };
    }
    return null;
  }

  private advance(): void {
    this.at += 1;
    this.foeMade = 0;
  }

  /** Moves past every step whose `until` the board has already reached. */
  private settle(): void {
    for (;;) {
      const step = this.step;
      if (!step || !("until" in step.advance)) return;
      if (this.session.question) return;
      if (!step.advance.until(this.session.state)) return;
      // Whatever it still had scripted is moot: the board is past it.
      this.advance();
    }
  }
}
