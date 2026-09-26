// Plays every lesson through from start to finish, headless, the way the
// screen would: the director's own moves on its timer, the moves PlayGame
// makes by itself, and the player doing exactly what each step asks.
//
// A lesson is a script over the real engine, so a change to a rule or a card
// can walk it off its path — a card it expects in hand is gone, a clash it
// explains comes out the other way. This is what notices.
//
// Run with: npm run test:tutorial -w client

import { legalIntents, type MatchIntent } from "@wuwatcg/shared";
import { PLAYER, TutorialDirector, type Lesson } from "../src/tutorial/director";
import { LESSONS } from "../src/tutorial/lessons";
import { colorLesson } from "../src/tutorial/colorLesson";
import { nothingLeftToDo, turnEnder } from "../src/game/turnFlow";

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  [${detail}]` : ""}`);
  if (ok) pass += 1;
  else fail += 1;
};

/** The move the open step asks the player for. */
function asked(d: TutorialDirector): MatchIntent | null {
  const step = d.step;
  if (!step || !("move" in step.advance)) return null;
  const spec = step.advance.move;
  const board = d.session.state.boards[PLAYER];
  const fromHand = () => {
    const card = board.hand.find((c) => (!spec.card || c.id === spec.card) && (!spec.color || c.color === spec.color));
    if (!card) throw new Error(`${step.id}: no ${spec.color ?? spec.card} card in hand`);
    return card.id;
  };
  switch (spec.kind) {
    case "commit":
    case "combo":
      return { kind: spec.kind, cardId: fromHand() };
    case "charge":
      return { kind: "charge", cardIds: [fromHand()] };
    case "switch":
      return { kind: "switch", toCardId: spec.card! };
    case "levelUp": {
      const card = board.characterPool.find((c) => c.id === spec.card);
      if (!card) throw new Error(`${step.id}: ${spec.card} is not in the pool`);
      return { kind: "levelUp", characterId: card.id, discardIds: board.hand.slice(0, card.level).map((c) => c.id) };
    }
    default:
      return { kind: spec.kind } as MatchIntent;
  }
}

/** What PlayGame would press by itself right now. */
function automatic(d: TutorialDirector): MatchIntent | null {
  const s = d.session.state;
  if (s.winnerId || d.session.question || turnEnder(s) !== PLAYER) return null;
  const legal = legalIntents(s, PLAYER);
  if (s.phase === "draw" && legal.includes("startTurn")) return { kind: "startTurn" };
  if (s.phase === "counter" && legal.includes("resolveCounter")) return { kind: "resolveCounter" };
  if (nothingLeftToDo(s)) return { kind: "endTurn" };
  return null;
}

/** Plays a lesson to its end. `onStep` sees each step as it opens. */
function playThrough(lesson: Lesson, onStep?: (d: TutorialDirector) => void): TutorialDirector {
  const d = new TutorialDirector(lesson);
  let seen: string | null = null;
  for (let guard = 0; guard < 1000 && !d.finished; guard += 1) {
    if (d.step && d.step.id !== seen) {
      seen = d.step.id;
      onStep?.(d);
    }
    const question = d.session.question;
    if (question && question.choice.playerId === PLAYER) {
      d.answer(question.choice.kind === "confirm" ? true : question.choice.options.slice(0, question.choice.min).map((o) => o.value));
      continue;
    }
    if (d.busy && d.tick()) continue;
    const auto = automatic(d);
    if (auto && d.play(auto)) continue;
    if (d.holding) {
      d.next();
      continue;
    }
    const move = asked(d);
    if (move && d.play(move)) continue;
    throw new Error(
      `stuck at ${d.step?.id} (turn ${d.session.state.turnNumber}, ${d.session.state.phase}): ${d.session.lastError ?? "nothing to do"}`
    );
  }
  if (!d.finished) throw new Error(`never finished (stopped at ${d.step?.id})`);
  return d;
}

for (const lesson of LESSONS) {
  try {
    const done = playThrough(lesson);
    if (process.env.TUTORIAL_LOG) {
      for (const line of done.session.log) console.log("     ", typeof line === "string" ? line : line.en);
    }
    check(`${lesson.id}: plays through to the end`, true);
  } catch (error) {
    check(`${lesson.id}: plays through to the end`, false, (error as Error).message);
  }
}

// --- Colours: the board says what the text says ------------------------------

{
  const lives: Record<string, [number, number]> = {};
  const clashes: string[] = [];
  const d = playThrough(colorLesson, (live) => {
    const s = live.session.state;
    lives[live.step!.id] = [s.boards.p1.life, s.boards.p2.life];
  });
  for (const line of d.session.log) {
    const en = typeof line === "string" ? line : line.en;
    if (/wins the clash|clash is a draw/.test(en)) clashes.push(en);
  }
  check("colours: turn 1 red beats green, 19 after the clash", lives["t1-result"]?.[1] === 19, String(lives["t1-result"]));
  check("colours: turn 2 green beats blue for 0", lives["t2-result"]?.[1] === 18, String(lives["t2-result"]));
  check("colours: turn 3 blue beats red, you take 3", lives["t3-result"]?.[0] === 17, String(lives["t3-result"]));
  check(
    "colours: the six clashes come out as the text says",
    JSON.stringify(clashes) ===
      JSON.stringify([
        "p1 wins the clash (red beats green)",
        "p1 wins the clash (green beats blue)",
        "p2 wins the clash (blue beats red)",
        "p1 wins the clash (Speed 8 vs 7)",
        "p1 wins the clash (same colour and Speed — the turn player wins)",
        "The clash is a draw",
      ]),
    clashes.join(" / ")
  );
}

// --- The script holds the player to it ------------------------------------------

{
  const d = new TutorialDirector(colorLesson);
  check("a step being read refuses the draw", !d.play({ kind: "startTurn" }));
  d.next();
  d.next();
  check("then the draw goes through", d.play({ kind: "startTurn" }));
  check("a move the step is not asking for is refused", !d.play({ kind: "skipCounter" }));
  check("the move it asks for is taken", d.play({ kind: "toBattle" }) && d.step?.id === "t1-commit");
  const green = d.session.state.boards[PLAYER].hand.find((c) => c.color === "green")!;
  check("the wrong colour is refused", !d.play({ kind: "commit", cardId: green.id }));
  check("and leaves the card in hand", d.session.state.boards[PLAYER].hand.includes(green));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
