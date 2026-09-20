// The bot: does it finish a game, does it stay inside the rules, and does it
// stay outside the other player's hand.
//
// The last one is the point of the file. A bot that cheats is not a harder
// bot, it is a broken game — and "it only reads the view" is the kind of
// claim that quietly stops being true the first time someone passes the wrong
// state in. So this does not inspect the code: it changes the opponent's hand
// behind the bot's back, between two identical questions, and checks the
// answer never moves. The only way that passes is if the hand was never
// reachable.
//
// Run with: npm run test:bot

import { botAnswer, botIntents, botStep } from "../src/bot";
import { ALL_CARDS } from "../src/cardDb";
import { HIDDEN_CARD_ID } from "../src/game";
import { isActionCard, type PendingChoice } from "../src/cardDef";
import { playableCharacters } from "../src/decks";
import type { ActionCard } from "../src/game";
import { MatchSession, starterDeck } from "../src/session";
import type { DeckList } from "../src/deckList";
import type { Seat } from "../src/types";

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  [${detail}]` : ""}`);
  ok ? (pass += 1) : (fail += 1);
};

const names = playableCharacters();
const SEATS: Seat[] = ["p1", "p2"];

/** Enough moves for a full game; a match that needs more is stuck. */
const MOVE_BUDGET = 1500;

function deal(game: number): MatchSession {
  const decks = {
    p1: starterDeck(names[game % names.length]),
    p2: starterDeck(names[(game + 3) % names.length]),
  } as Record<Seat, DeckList>;
  return MatchSession.deal(`bot-${game}`, decks, game * 7919 + 13);
}

/**
 * Plays a whole game with the bot on both sides.
 *
 * `stuck` counts ticks where neither seat could move: the engine refused
 * everything the bot offered, or it offered nothing at all. One is a bug in
 * the policy, not a slow game, so it is counted rather than waited out.
 */
function playOut(session: MatchSession): { moves: number; stuck: number } {
  let moves = 0;
  let stuck = 0;
  while (!session.winnerId && moves < MOVE_BUDGET) {
    const moved = SEATS.some((seat) => botStep(session, seat));
    moves += 1;
    if (!moved) {
      stuck += 1;
      // One stall is a finding; ten in a row is the same finding on a loop.
      if (stuck > 10) break;
    } else {
      stuck = 0;
    }
  }
  return { moves, stuck };
}

// --- It plays games, and they end ------------------------------------------

{
  const GAMES = 20;
  let finished = 0;
  let everStuck = 0;
  let totalTurns = 0;
  let totalMoves = 0;
  for (let game = 0; game < GAMES; game += 1) {
    const session = deal(game);
    const { moves, stuck } = playOut(session);
    if (session.winnerId) finished += 1;
    if (stuck > 0) everStuck += 1;
    totalTurns += session.state.turnNumber;
    totalMoves += moves;
  }
  check(
    "บอทเล่นจนจบเกมได้ทุกเกม",
    finished === GAMES,
    `${finished}/${GAMES} เกมมีผู้ชนะ`
  );
  check(
    "ไม่มีเกมไหนที่บอทเดินต่อไม่ได้",
    everStuck === 0,
    `${everStuck} เกมติด`
  );
  console.log(
    `      (เฉลี่ย ${(totalTurns / GAMES).toFixed(1)} เทิร์น, ${(totalMoves / GAMES).toFixed(0)} การตัดสินใจต่อเกม)`
  );
}

// --- Every move it offers is one the engine takes ---------------------------

{
  // Nothing the bot proposes FIRST should be refused: the fallbacks further
  // down its list are a safety net, not the plan.
  let firstChoiceTaken = 0;
  let decisions = 0;
  const session = deal(101);
  let guard = 0;
  while (!session.winnerId && guard < MOVE_BUDGET) {
    guard += 1;
    let moved = false;
    for (const seat of SEATS) {
      const update = session.updateFor(seat);
      if (update.askingSeat && update.askingSeat !== seat) continue;
      if (update.pending) {
        if (session.answer(seat, botAnswer(update.view, seat, update.pending))) moved = true;
        continue;
      }
      const [first] = botIntents(update.view, seat);
      if (!first) continue;
      decisions += 1;
      if (session.apply(seat, first)) {
        firstChoiceTaken += 1;
        moved = true;
      } else if (botStep(session, seat)) {
        moved = true;
      }
    }
    if (!moved) break;
  }
  check(
    "ตัวเลือกแรกของบอทถูกกฎเสมอ",
    decisions > 0 && firstChoiceTaken === decisions,
    `${firstChoiceTaken}/${decisions}`
  );
}

// --- It cannot see the other hand -------------------------------------------

{
  // Play a few moves in, so there is a real board to decide on rather than an
  // opening where every answer is forced.
  const session = deal(202);
  for (let i = 0; i < 40 && !session.winnerId; i += 1) {
    for (const seat of SEATS) botStep(session, seat);
  }

  const before = JSON.stringify(botIntents(session.updateFor("p2").view, "p2"));

  // Now swap p1's whole hand for different cards, without touching anything
  // p2 is entitled to see: same number of cards, same trash, same board.
  const pool = ALL_CARDS.filter(isActionCard);
  const hand = session.state.boards.p1.hand;
  const swapped: ActionCard[] = hand.map((card, index) => {
    const source = pool[(index * 17 + 5) % pool.length];
    return {
      id: source.id,
      name: source.name,
      color: source.color,
      cost: source.cost,
      damage: source.attack,
      speed: source.speed ?? 0,
      imageId: source.imageId,
    };
  });
  const changed = swapped.some((card, index) => card.id !== hand[index]?.id);
  session.state.boards.p1.hand = swapped;

  const after = JSON.stringify(botIntents(session.updateFor("p2").view, "p2"));

  check("การทดสอบนี้เปลี่ยนไพ่ในมือฝ่ายตรงข้ามจริง", changed);
  check("เปลี่ยนไพ่ในมือผู้เล่นแล้ว บอทตัดสินใจเหมือนเดิม — แปลว่ามันมองไม่เห็น", before === after);
}

// --- And the player cannot see the bot's hand either -------------------------

{
  // The bot screen draws `updateFor("p1").view`, not the raw board, which is
  // what makes a match against it a game rather than a solitaire puzzle. Same
  // filter, pointed the other way.
  const session = deal(505);
  for (let i = 0; i < 30 && !session.winnerId; i += 1) {
    for (const seat of SEATS) botStep(session, seat);
  }
  const shown = session.updateFor("p1").view;
  const botHand = shown.boards.p2.hand;
  const real = session.state.boards.p2.hand;

  check(
    "ผู้เล่นมองไม่เห็นไพ่ในมือบอทเหมือนกัน",
    botHand.length > 0 && botHand.every((card) => card.id.startsWith(HIDDEN_CARD_ID)),
    `${botHand.length} ใบ`
  );
  check(
    "แต่ยังนับจำนวนไพ่ในมือเขาได้ (ข้อมูลสาธารณะ)",
    botHand.length === real.length
  );
}

// --- Choices go the way that helps it ---------------------------------------

{
  const session = deal(303);
  const pool = ALL_CARDS.filter(isActionCard);
  const strongest = [...pool].sort((a, b) => b.attack - a.attack)[0];
  const weakest = [...pool].sort((a, b) => a.attack - b.attack || b.cost - a.cost)[0];
  const asCard = (source: (typeof pool)[number]): ActionCard => ({
    id: source.id,
    name: source.name,
    color: source.color,
    cost: source.cost,
    damage: source.attack,
    speed: source.speed ?? 0,
    imageId: source.imageId,
  });

  // Both live in the bot's own trash, which is where a "take one back" and a
  // "bin one" question would both be drawn from.
  session.state.boards.p2.trash.push(asCard(strongest), asCard(weakest));
  const view = session.updateFor("p2").view;

  const question = (tag: PendingChoice["tag"]): PendingChoice => ({
    kind: "pickCard",
    playerId: "p2",
    cardId: "test",
    prompt: { th: "", en: "" },
    options: [
      { value: "0:strong", cardId: strongest.id, label: { th: "", en: "" } },
      { value: "1:weak", cardId: weakest.id, label: { th: "", en: "" } },
    ],
    min: 1,
    max: 1,
    tag,
  });

  check(
    "ให้เลือกการ์ดขึ้นมือ -> เลือกใบที่ดีที่สุด",
    botAnswer(view, "p2", question("trashToHand")) === "0:strong",
    `${strongest.id} attack ${strongest.attack}`
  );
  check(
    "ให้เลือกการ์ดที่จะทิ้ง -> เลือกใบที่ไร้ประโยชน์ที่สุด",
    botAnswer(view, "p2", question("discard")) === "1:weak",
    `${weakest.id} attack ${weakest.attack}`
  );
  check(
    "คำถามแบบ yes/no ของการ์ดตัวเอง -> ตอบรับ",
    botAnswer(view, "p2", {
      kind: "confirm",
      playerId: "p2",
      cardId: "test",
      prompt: { th: "", en: "" },
      options: [],
      min: 1,
      max: 1,
    }) === true
  );
}

// --- It beats the brainless opponent the fuzz suite uses --------------------

{
  // Not a tuning target, a floor: a bot that cannot beat "always the first
  // card in hand" is not making decisions, it is shuffling them.
  let botWins = 0;
  const GAMES = 16;
  for (let game = 0; game < GAMES; game += 1) {
    const session = deal(game + 400);
    // The bot sits in p2 half the time, so neither the coin toss nor the
    // starter deck it happens to get can carry the result.
    const botSeat: Seat = game % 2 === 0 ? "p2" : "p1";
    const dumbSeat: Seat = botSeat === "p2" ? "p1" : "p2";
    let guard = 0;
    while (!session.winnerId && guard < MOVE_BUDGET) {
      guard += 1;
      const moved = botStep(session, botSeat) || dumbStep(session, dumbSeat);
      if (!moved) break;
    }
    if (session.winnerId === botSeat) botWins += 1;
  }
  check(
    "บอทชนะคู่ต่อสู้ที่เล่นมั่วอย่างน้อยครึ่งหนึ่ง",
    botWins * 2 >= GAMES,
    `${botWins}/${GAMES}`
  );
}

/**
 * The opponent from the fuzz suite: legal, and that is all. Takes the first
 * card it can and answers the first option of every question.
 */
function dumbStep(session: MatchSession, seat: Seat): boolean {
  const update = session.updateFor(seat);
  if (update.askingSeat && update.askingSeat !== seat) return false;
  if (update.pending) {
    return session.answer(seat, update.pending.options[0]?.value ?? true);
  }
  const view = update.view;
  const board = view.boards[seat];
  if (!board) return false;
  const tries: Parameters<MatchSession["apply"]>[1][] = [
    { kind: "mulligan", cardIds: [] },
    { kind: "startTurn" },
    { kind: "toBattle" },
    ...board.hand.map((card) => ({ kind: "commit" as const, cardId: card.id })),
    { kind: "pass" },
    { kind: "resolveCounter" },
    { kind: "passCombo" },
    { kind: "endTurn" },
  ];
  return tries.some((intent) => session.apply(seat, intent));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
