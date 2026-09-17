// Plays real turns through the real engine with real cards.
//
// The other suites each poke at one piece. This one is the only test that
// answers "does a game actually run" — setup, draw, actions, the clash, a
// combo, the end phase, and the turn passing over.
//
// Run with: npm run test:match
import { requireCard } from "../src/cardDb";
import type { ChoiceAnswer } from "../src/cardDef";
import { recomputeContinuous, resolveTrigger, sourcesInPlay } from "../src/effects";
import {
  canCommitAnything,
  createMatch,
  legalIntents,
  step,
  viewFor,
  type MatchIntent,
  type StepResult,
} from "../src/match";
import type { ActionCard, CharacterCard, MatchState } from "../src/game";
import { CHARGE_PER_TURN, HAND_LIMIT, HIDDEN_CARD_ID } from "../src/game";
import { ACTION_DECK_SIZE } from "../src/rules";

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  [${detail}]` : ""}`);
  ok ? (pass += 1) : (fail += 1);
};

// --- Building a legal match ------------------------------------------------

function character(id: string): CharacterCard {
  const def = requireCard(id);
  if (def.type !== "leader") throw new Error(`${id} is not a character card`);
  return { id: def.id, name: def.name, level: def.level, imageId: def.imageId };
}

function action(id: string): ActionCard {
  const def = requireCard(id);
  if (def.type !== "action") throw new Error(`${id} is not an action card`);
  return {
    id: def.id,
    name: def.name,
    color: def.color,
    cost: def.cost,
    damage: def.attack,
    // Blue cards print no Speed; combat never reads it for blue-on-blue.
    speed: def.speed ?? 0,
    imageId: def.imageId,
  };
}

/** A 40-card deck built by repeating the ids given, in order. */
function deck(ids: string[]): ActionCard[] {
  const out: ActionCard[] = [];
  while (out.length < ACTION_DECK_SIZE) out.push(action(ids[out.length % ids.length]));
  return out;
}

// Three characters take the field, so every Character Deck below names three
// with a Level 0 card. CAMELLYA leads the first, ENCORE the second.
const CAMELLYA = [
  "BP01-005", "BP01-003", "BP01-001", // Camellya  L0 -> L1 -> L2
  "BP01-024", "BP01-023",             // Yangyang  L0 -> L1
  "BP01-027", "BP01-026",             // Chixia    L0 -> L1
];
const ENCORE = [
  "BP01-015", "BP01-013", "BP01-011", // Encore
  "BP01-030", "BP01-029",             // Jinshi
  "BP01-033", "BP01-032",             // Sanhua
];

// BP01-044 red spd8 atk1, BP01-049 red cost2 spd13 atk5, BP01-045 blue atk3.
const P1_DECK = ["BP01-044", "BP01-049", "BP01-047", "BP01-045"];
const P2_DECK = ["BP01-045", "BP01-044", "BP01-047", "BP01-049"];

function newMatch(): MatchState {
  return createMatch({
    matchId: "test",
    startingPlayerId: "p1",
    players: [
      { playerId: "p1", characterDeck: CAMELLYA.map(character), actionDeck: deck(P1_DECK) },
      { playerId: "p2", characterDeck: ENCORE.map(character), actionDeck: deck(P2_DECK) },
    ],
  });
}

/**
 * Drives one intent to completion the way the server will: answer every
 * question the step raises, replaying from the same state each time.
 *
 * Questions are answered by `reply`; the default takes the first option, or
 * yes. Returns the finished result plus the questions that came up.
 */
function drive(
  state: MatchState,
  playerId: string,
  intent: MatchIntent,
  reply: (choice: NonNullable<StepResult["pending"]>) => ChoiceAnswer = (choice) =>
    choice.kind === "confirm" ? true : choice.options[0]?.value ?? ""
): { result: StepResult; asked: string[] } {
  const answers: ChoiceAnswer[] = [];
  const asked: string[] = [];
  for (let guard = 0; guard < 20; guard += 1) {
    const result = step(state, playerId, intent, answers);
    if (!result.pending) return { result, asked };
    asked.push(result.pending.cardId);
    answers.push(reply(result.pending));
  }
  throw new Error("a step kept asking questions — it is not replaying deterministically");
}

// --- Setup -----------------------------------------------------------------

{
  const s = newMatch();
  check("ตั้งเกม: Leader เป็นการ์ด Level 0", s.boards.p1.leader?.card.id === "BP01-005");
  check("มือเริ่มต้น 5 ใบ", s.boards.p1.hand.length === 5, `${s.boards.p1.hand.length}`);
  check(
    "เด็คเหลือ 35 ใบ",
    s.boards.p1.actionDeck.length === ACTION_DECK_SIZE - 5,
    `${s.boards.p1.actionDeck.length}`
  );
  check(
    "ลงสนาม 3 ตัว: Leader 1 + หลัง 2",
    s.boards.p1.leader !== null && s.boards.p1.back.length === 2,
    `back=${s.boards.p1.back.length}`
  );
  check(
    "ตัวที่ลงสนามเป็นคนละตัวละคร",
    new Set([s.boards.p1.leader!.card.name, ...s.boards.p1.back.map((b) => b.card.name)]).size === 3
  );
  check("ทุกตัวเริ่มที่ Level 0", s.boards.p1.back.every((b) => b.card.level === 0));
  check(
    "การ์ดตัวละครที่เหลืออยู่ใน pool",
    s.boards.p1.characterPool.length === CAMELLYA.length - 3,
    `${s.boards.p1.characterPool.length}`
  );
  check("เริ่มที่เฟสจั่ว เทิร์น 1", s.phase === "draw" && s.turnNumber === 1);

  let threw = "";
  try {
    createMatch({
      matchId: "bad",
      startingPlayerId: "p1",
      players: [
        { playerId: "p1", characterDeck: [character("BP01-005")], actionDeck: deck(P1_DECK) },
        { playerId: "p2", characterDeck: ENCORE.map(character), actionDeck: deck(P2_DECK) },
      ],
    });
  } catch (error) {
    threw = error instanceof Error ? error.message : String(error);
  }
  check("เด็คตัวละครน้อยเกินไป -> ไม่ยอมเริ่มเกม", threw.includes("Character Deck"), threw);
}

// --- Draw Phase ------------------------------------------------------------

let game = newMatch();
{
  const { result } = drive(game, "p1", { kind: "startTurn" });
  check("เทิร์นแรกของผู้เริ่ม จั่ว 1 ใบ", result.state.boards.p1.hand.length === 6, `${result.state.boards.p1.hand.length}`);
  check("จั่วจบแล้วเข้าเฟสแอ็กชัน", result.state.phase === "action");
  check("ไม่มีเอฟเฟคค้าง", result.error === null);
  game = result.state;
}

// --- Action Phase ----------------------------------------------------------

{
  const first = game.boards.p1.hand[0].id;
  const { result } = drive(game, "p1", { kind: "charge", cardIds: [first] });
  check("ชาร์จ: การ์ดย้ายไป Concerto", result.state.boards.p1.competitionArea.length === 1);
  check("ชาร์จ: มือลดลง", result.state.boards.p1.hand.length === 5);
  game = result.state;

  const again = step(game, "p1", { kind: "charge", cardIds: [game.boards.p1.hand[0].id] });
  check("ชาร์จซ้ำในเทิร์นเดียว -> ถูกปฏิเสธ", again.error !== null, again.error ?? "");
  check("ถูกปฏิเสธแล้ว state ไม่เปลี่ยน", again.state === game);

  const notMine = step(game, "p2", { kind: "charge", cardIds: [game.boards.p2.hand[0].id] });
  check("ไม่ใช่เทิร์นตัวเอง -> ถูกปฏิเสธ", notMine.error === "It is not your turn", notMine.error ?? "");
}

// --- Paying a cost happens when the card is turned up ----------------------

{
  const base = drive(newMatch(), "p1", { kind: "startTurn" }).result.state;

  const two = step(base, "p1", {
    kind: "charge",
    cardIds: [base.boards.p1.hand[0].id, base.boards.p1.hand[1].id],
  });
  check("ชาร์จ 2 ใบในเทิร์นเดียว -> ถูกปฏิเสธ", two.error !== null, two.error ?? "");
  check("ชาร์จได้เทิร์นละใบเดียว", CHARGE_PER_TURN === 1);

  // A cost 2 card with an empty Concerto area cannot even be committed.
  let s = structuredClone(base);
  s.phase = "counter";
  s.boards.p1.hand = [action("BP01-049")]; // Camellya, cost 2
  s.boards.p2.hand = [action("BP01-044")]; // cost 0
  const broke = step(s, "p1", { kind: "commit", cardId: "BP01-049" });
  check("จ่าย cost ไม่ไหว -> ลงไม่ได้", broke.error?.includes("Concerto") === true, broke.error ?? "");

  // With enough charged it commits — but nothing is spent while it is still
  // face-down, because a card that has not been turned up has not been played.
  s.boards.p1.competitionArea = [action("BP01-044"), action("BP01-047")];
  const committed = step(s, "p1", { kind: "commit", cardId: "BP01-049" });
  check("ลงคว่ำได้", committed.error === null, committed.error ?? "");
  check(
    "ยังคว่ำอยู่ -> ยังไม่จ่าย",
    committed.state.boards.p1.competitionArea.length === 2,
    `เหลือ ${committed.state.boards.p1.competitionArea.length}`
  );

  const both = step(committed.state, "p2", { kind: "commit", cardId: "BP01-044" });
  const { result } = drive(both.state, "p1", { kind: "resolveCounter" });
  check(
    "หงายการ์ดแล้วจึงจ่าย",
    result.state.boards.p1.competitionArea.length === 0,
    `เหลือ ${result.state.boards.p1.competitionArea.length}`
  );
  // They land in the trash, but Camellya's own Leader Skill may immediately
  // pull a {Basic Attack} back out of it — so the check is that they left the
  // Concerto area, not that they are still sitting in the trash.
  const paidCards = ["BP01-044", "BP01-047"];
  check(
    "การ์ดที่จ่ายไปออกจาก Concerto",
    paidCards.every((id) => !result.state.boards.p1.competitionArea.some((c) => c.id === id)),
    JSON.stringify(result.state.boards.p1.competitionArea.map((c) => c.id))
  );
  check(
    "และไปโผล่ที่กองทิ้ง (หรือถูกเอฟเฟคดึงกลับขึ้นมือ)",
    paidCards.every(
      (id) =>
        result.state.boards.p1.trash.some((c) => c.id === id) ||
        result.state.boards.p1.hand.some((c) => c.id === id)
    ),
    `trash=${result.state.boards.p1.trash.map((c) => c.id).join(",")} hand=${result.state.boards.p1.hand.map((c) => c.id).join(",")}`
  );
  check(
    "บันทึกการจ่ายลงล็อก",
    result.log.some((line) => line.includes("pays 2")),
    result.log.filter((l) => l.includes("pay")).join(" | ")
  );

  // Paying is exact: a cost 1 card takes one of the two and leaves one.
  let one = structuredClone(s);
  one.boards.p1.hand = [action("BP01-048")]; // cost 1
  const c1 = step(one, "p1", { kind: "commit", cardId: "BP01-048" });
  const c2 = step(c1.state, "p2", { kind: "commit", cardId: "BP01-044" });
  const partial = drive(c2.state, "p1", { kind: "resolveCounter" }).result;
  check(
    "จ่ายพอดี ไม่ใช้เกิน",
    partial.state.boards.p1.competitionArea.length === 1,
    `เหลือ ${partial.state.boards.p1.competitionArea.length}`
  );

  check("มีพลังงานพอ -> ลงการ์ดได้", canCommitAnything(base, "p1") === true);
  const noEnergy = structuredClone(base);
  noEnergy.boards.p1.hand = [action("BP01-049")];
  noEnergy.boards.p1.competitionArea = [];
  check("มีแต่การ์ดที่จ่ายไม่ไหว -> ต้องกดไม่ลงการ์ด", canCommitAnything(noEnergy, "p1") === false);
}

// --- Level Up, and a card that asks a question -----------------------------

{
  // BP01-003 is "[Enter] / [Level up] you may take a {Basic Attack} from the
  // trash" — it asks, so this exercises suspend-and-replay through a step.
  const seeded = structuredClone(game);
  seeded.boards.p1.trash.push(action("BP01-051")); // a {Basic Attack} to fetch
  seeded.boards.p1.hand = seeded.boards.p1.hand.filter((c) => c.id !== "BP01-051");
  const discard = seeded.boards.p1.hand[0].id;

  const { result, asked } = drive(seeded, "p1", {
    kind: "levelUp",
    characterId: "BP01-003",
    discardIds: [discard],
  });
  check("เลเวลอัป: Leader กลายเป็นการ์ด Level 1", result.state.boards.p1.leader?.card.id === "BP01-003");
  check(
    "เลเวลอัป: การ์ดเดิมอยู่ใต้ใบใหม่ ไม่ได้หายไป",
    result.state.boards.p1.leader?.under.map((c) => c.id).join() === "BP01-005",
    result.state.boards.p1.leader?.under.map((c) => c.id).join() ?? "-"
  );
  check("เลเวลอัป: ทิ้งการ์ดตามค่าเลเวล", result.state.boards.p1.trash.some((c) => c.id === discard));
  // BP01-003 prints "[Enter] / [Level up]" — two triggers on one effect, so
  // this also proves the levelUp half is reachable, not just the enter half.
  check("เอฟเฟคถามผู้เล่นระหว่างเลเวลอัป", asked.includes("BP01-003"), asked.join(","));
  check("ตอบตกลง -> ได้การ์ดจากกองทิ้งขึ้นมือ", result.state.boards.p1.hand.some((c) => c.id === "BP01-051"));
  check("ตอบตกลง -> การ์ดออกจากกองทิ้ง", !result.state.boards.p1.trash.some((c) => c.id === "BP01-051"));

  // The same step, answered "no", must leave the card where it was.
  const declined = drive(
    seeded,
    "p1",
    { kind: "levelUp", characterId: "BP01-003", discardIds: [discard] },
    () => ""
  );
  check(
    "ตอบปฏิเสธ -> การ์ดยังอยู่กองทิ้ง",
    declined.result.state.boards.p1.trash.some((c) => c.id === "BP01-051")
  );
  check("ตอบปฏิเสธ -> ไม่ขึ้นมือ", !declined.result.state.boards.p1.hand.some((c) => c.id === "BP01-051"));

  const wrongCost = step(seeded, "p1", { kind: "levelUp", characterId: "BP01-003", discardIds: [] });
  check("ทิ้งการ์ดไม่ครบ -> ถูกปฏิเสธ", wrongCost.error !== null, wrongCost.error ?? "");

  const skipLevel = step(seeded, "p1", { kind: "levelUp", characterId: "BP01-011", discardIds: [] });
  check("เลเวลอัปข้ามตัวละคร -> ถูกปฏิเสธ", skipLevel.error !== null, skipLevel.error ?? "");

  // Camellya is at Level 0 here, so her Level 2 card is two steps away.
  const jump = step(seeded, "p1", {
    kind: "levelUp",
    characterId: "BP01-001",
    discardIds: seeded.boards.p1.hand.slice(0, 2).map((c) => c.id),
  });
  check(
    "0 -> 2 ข้ามเลเวล -> ถูกปฏิเสธ",
    jump.error?.includes("one level at a time") === true,
    jump.error ?? ""
  );

  // Step up to 1 first, and the Level 2 card becomes legal.
  const stepped = drive(seeded, "p1", {
    kind: "levelUp",
    characterId: "BP01-003",
    discardIds: [discard],
  }).result.state;
  stepped.boards.p1.actionsTakenThisTurn = [];
  const next = step(stepped, "p1", {
    kind: "levelUp",
    characterId: "BP01-001",
    discardIds: stepped.boards.p1.hand.slice(0, 2).map((c) => c.id),
  });
  check("ขึ้นทีละเลเวล 0 -> 1 -> 2 ได้", next.error === null, next.error ?? "");
}

// --- Switch, and the pile a character becomes -------------------------------

{
  const s = drive(newMatch(), "p1", { kind: "startTurn" }).result.state;
  const back = s.boards.p1.back[0].card;
  const wasLeader = s.boards.p1.leader!.card;

  const { result } = drive(s, "p1", { kind: "switch", toCardId: back.id });
  check("สลับ Leader: ตัวหลังขึ้นมาเป็น Leader", result.state.boards.p1.leader?.card.id === back.id);
  check(
    "สลับ Leader: ตัวเดิมลงไปอยู่ข้างหลัง",
    result.state.boards.p1.back.some((slot) => slot.card.id === wasLeader.id)
  );
  check("สลับ Leader: ยังมี 3 ตัวบนสนาม", result.state.boards.p1.back.length === 2);
  check(
    "ตำแหน่งถูกอัปเดตตามที่ย้าย",
    result.state.boards.p1.leader?.position === "leader" &&
      result.state.boards.p1.back.every((slot) => slot.position === "back")
  );

  const twice = step(result.state, "p1", { kind: "switch", toCardId: back.id });
  check("สลับซ้ำในเทิร์นเดียวไม่ได้", twice.error !== null, twice.error ?? "");

  // A levelled-up character keeps their lower levels when they move.
  const levelled = drive(s, "p1", {
    kind: "levelUp",
    characterId: "BP01-003",
    discardIds: [s.boards.p1.hand[0].id],
  }).result.state;
  check("เลเวลอัปแล้วกองซ้อนสูงขึ้น", levelled.boards.p1.leader?.under.length === 1);

  const moved = drive(levelled, "p1", { kind: "switch", toCardId: back.id }).result.state;
  const camellya = moved.boards.p1.back.find((slot) => slot.card.id === "BP01-003");
  check(
    "สลับแล้วกองซ้อนย้ายไปทั้งกอง",
    camellya?.under.map((c) => c.id).join() === "BP01-005",
    camellya?.under.map((c) => c.id).join() ?? "หาไม่เจอ"
  );
}

// --- A character pile: every level in it is still in play -------------------

{
  // Camellya levelled 0 -> 1. BP01-005 (Level 0) has "[Leader] [Judgement] if
  // you won, take a {Basic attack} from the trash"; it sits UNDER BP01-003
  // now, and must still fire.
  let s = drive(newMatch(), "p1", { kind: "startTurn" }).result.state;
  s = drive(s, "p1", {
    kind: "levelUp",
    characterId: "BP01-003",
    discardIds: [s.boards.p1.hand[0].id],
  }).result.state;

  const leader = s.boards.p1.leader!;
  check(
    "กองซ้อน: ใบบนคือเลเวลปัจจุบัน ใบเก่าอยู่ใต้",
    leader.card.id === "BP01-003" && leader.under.map((c) => c.id).join() === "BP01-005",
    `บน=${leader.card.id} ล่าง=${leader.under.map((c) => c.id).join()}`
  );

  const sources = sourcesInPlay(s, "judgement").filter((src) => src.controllerId === "p1");
  check(
    "เอฟเฟคทำงานทุกใบในกอง ไม่ใช่แค่ใบบนสุด",
    sources.some((src) => src.card.id === "BP01-005") &&
      sources.some((src) => src.card.id === "BP01-003"),
    sources.map((src) => src.card.id).join(",")
  );
  check(
    "ใบที่อยู่ใต้ยังนับเป็นโซน leader",
    sources.filter((src) => src.card.id === "BP01-005").every((src) => src.zone === "leader")
  );

  // The buried Level 0 skill actually resolves.
  const won = structuredClone(s);
  won.lastBattleWinnerId = "p1";
  won.boards.p1.trash = [action("BP01-044")]; // a {Basic Attack}
  const handBefore = won.boards.p1.hand.length;
  const fired = resolveTrigger(won, "judgement", sourcesInPlay(won, "judgement"));
  check(
    "สกิลของใบที่ถูกซ้อนทับยังทำงานจริง",
    fired.state.boards.p1.hand.length === handBefore + 1,
    `hand ${handBefore} -> ${fired.state.boards.p1.hand.length}`
  );
}

// --- Returning a character takes that card only ----------------------------

{
  // BP01-001 is Camellya Level 2, "[Level up] return this card to the
  // Character deck". Level 0 -> 1 -> 2 and the Level 2 card bounces straight
  // back, leaving the character standing at Level 1.
  let s = drive(newMatch(), "p1", { kind: "startTurn" }).result.state;
  s = drive(s, "p1", {
    kind: "levelUp",
    characterId: "BP01-003",
    discardIds: [s.boards.p1.hand[0].id],
  }).result.state;
  s = drive(s, "p1", { kind: "endTurn" }).result.state;
  s = drive(s, "p2", { kind: "endTurn" }).result.state;
  s = drive(s, "p1", { kind: "startTurn" }).result.state;

  const poolBefore = s.boards.p1.characterPool.length;
  const { result } = drive(s, "p1", {
    kind: "levelUp",
    characterId: "BP01-001",
    discardIds: s.boards.p1.hand.slice(0, 2).map((c) => c.id),
  });

  const after = result.state.boards.p1;
  check(
    "ใบที่สั่ง return กลับเข้า pool",
    after.characterPool.some((c) => c.id === "BP01-001"),
    after.characterPool.map((c) => c.id).join(",")
  );
  check(
    "ตัวละครยังอยู่บนสนาม ไม่ได้หายไปทั้งกอง",
    after.leader !== null && after.leader.card.id === "BP01-003",
    after.leader ? after.leader.card.id : "ไม่มี Leader"
  );
  check(
    "ใบที่อยู่ใต้ไม่ถูกส่งกลับไปด้วย",
    after.leader?.under.map((c) => c.id).join() === "BP01-005",
    after.leader?.under.map((c) => c.id).join() ?? "-"
  );
  check(
    "pool เพิ่มขึ้นสุทธิ 0 ใบ (เอาไป 1 คืนมา 1)",
    after.characterPool.length === poolBefore,
    `${poolBefore} -> ${after.characterPool.length}`
  );
}

// --- Playing nothing, and giving up ----------------------------------------

{
  let s = newMatch();
  s.phase = "counter";
  s.boards.p1.hand = [action("BP01-044")];
  s.boards.p2.hand = []; // nothing to play

  check("มือว่าง -> ลงการ์ดไม่ได้", canCommitAnything(s, "p2") === false);
  check("ยังมีการ์ด -> ลงได้", canCommitAnything(s, "p1") === true);

  const stuck = step(s, "p2", { kind: "commit", cardId: "BP01-044" });
  check("ลงการ์ดที่ไม่มีในมือ -> ถูกปฏิเสธ", stuck.error !== null, stuck.error ?? "");

  const c1 = step(s, "p1", { kind: "commit", cardId: "BP01-044" });
  const c2 = step(c1.state, "p2", { kind: "pass" });
  check("ไม่ลงการ์ดได้ และนับว่าเลือกแล้ว", c2.error === null && c2.state.committed.p2 === true);
  check(
    "เลือกครบแล้วเปิดการ์ดได้",
    legalIntents(c2.state, "p1").includes("resolveCounter"),
    legalIntents(c2.state, "p1").join(",")
  );

  const { result } = drive(c2.state, "p1", { kind: "resolveCounter" });
  check("ฝ่ายที่ลงการ์ดฝ่ายเดียวชนะ", result.state.lastBattleWinnerId === "p1");
  check(
    "ดาเมจเข้าเต็มเพราะไม่มีอะไรมาปะทะ",
    result.state.boards.p2.life === 19,
    `${result.state.boards.p2.life}`
  );
  check("Action Area ของฝ่ายที่ไม่ลงว่างเปล่า", result.state.actionZone.p2.length === 0);

  // Neither side plays: nothing happens at all.
  let quiet = newMatch();
  quiet.phase = "counter";
  const q1 = step(quiet, "p1", { kind: "pass" });
  const q2 = step(q1.state, "p2", { kind: "pass" });
  const both = drive(q2.state, "p1", { kind: "resolveCounter" }).result;
  check("ไม่ลงทั้งคู่ -> ไม่มีการปะทะ", both.state.lastBattleWinnerId === null);
  check(
    "ไม่ลงทั้งคู่ -> ไม่มีใครเสียเลือด",
    both.state.boards.p1.life === 20 && both.state.boards.p2.life === 20
  );
  check("ไม่ลงทั้งคู่ -> ไม่มีคอมโบ", both.state.combo === null);
}

{
  const s = drive(newMatch(), "p1", { kind: "startTurn" }).result.state;
  const out = step(s, "p1", { kind: "concede" });
  check("ยอมแพ้ -> อีกฝ่ายชนะทันที", out.state.winnerId === "p2", `${out.state.winnerId}`);
  const after = step(out.state, "p2", { kind: "endTurn" });
  check("ยอมแพ้แล้วเล่นต่อไม่ได้", after.error === "The match is already over", after.error ?? "");
}

// --- The clash -------------------------------------------------------------

{
  // p1 plays red, p2 plays blue: blue beats red, so p2 should win and p1 takes 3.
  let s = structuredClone(game);
  s.boards.p1.hand = [action("BP01-044")]; // red, atk 1
  s.boards.p2.hand = [action("BP01-045")]; // blue, atk 3

  const c1 = step(s, "p1", { kind: "commit", cardId: "BP01-044" });
  check("ลงการ์ดคว่ำ -> เข้าเฟส counter", c1.state.phase === "counter" && c1.error === null);
  check("การ์ดคว่ำออกจากมือ", c1.state.boards.p1.hand.length === 0);

  const early = step(c1.state, "p1", { kind: "resolveCounter" });
  check("อีกฝ่ายยังไม่ลง -> เปิดไม่ได้", early.error !== null, early.error ?? "");

  const c2 = step(c1.state, "p2", { kind: "commit", cardId: "BP01-045" });
  const twice = step(c2.state, "p2", { kind: "commit", cardId: "BP01-045" });
  check("ลงการ์ดคว่ำซ้ำ -> ถูกปฏิเสธ", twice.error !== null, twice.error ?? "");

  const { result } = drive(c2.state, "p1", { kind: "resolveCounter" });
  check("ฟ้าชนะแดง", result.state.lastBattleWinnerId === "p2", `${result.state.lastBattleWinnerId}`);
  check("ผู้แพ้เสียเลือดเท่าแอทแทคผู้ชนะ", result.state.boards.p1.life === 17, `${result.state.boards.p1.life}`);
  check("บันทึกดาเมจลง turnLog", result.state.turnLog.damageTaken.p1 === 3);
  check("การ์ดที่เปิดอยู่ใน Action Zone", result.state.actionZone.p1[0]?.id === "BP01-044");
  check("บันทึกการ์ดที่เล่นลง turnLog", result.state.turnLog.cardsPlayed.p2?.length === 1);
  check("เปิดเสร็จเข้าขั้นคอมโบ", result.state.phase === "combo");
  check(
    "ผู้ชนะด้วยฟ้าได้คอมโบตาม Follow{x} เท่านั้น",
    result.state.combo?.playerId === "p2" && result.state.combo.unlimited === false,
    JSON.stringify(result.state.combo)
  );
  game = result.state;
}

// --- Combo Step ------------------------------------------------------------

{
  const loser = step(game, "p1", { kind: "combo", cardId: "BP01-044" });
  check("ผู้แพ้คอมโบไม่ได้", loser.error === "You did not win the clash", loser.error ?? "");

  // Blue's Follow{x} is 0 here, so p2 has no follow-ups either.
  let s = structuredClone(game);
  s.boards.p2.hand = [action("BP01-044")];
  const noneLeft = step(s, "p2", { kind: "combo", cardId: "BP01-044" });
  check("ไม่มีสิทธิ์ follow-up เหลือ -> คอมโบไม่ได้", noneLeft.error === "No follow-ups left", noneLeft.error ?? "");

  // A red win grants unlimited combos — check one actually lands damage.
  const red = structuredClone(s);
  red.combo = { playerId: "p2", unlimited: true, remaining: Infinity };
  const life = red.boards.p1.life;
  const zoneBefore = red.actionZone.p2.length;
  const { result } = drive(red, "p2", { kind: "combo", cardId: "BP01-044" });
  check(
    "คอมโบ: การ์ดต่อท้ายใน Action Zone",
    result.state.actionZone.p2.length === zoneBefore + 1 &&
      result.state.actionZone.p2.at(-1)?.id === "BP01-044",
    `${result.state.actionZone.p2.length}`
  );
  check("คอมโบ: โจมตีต่อเนื่องเข้าเป้า", result.state.boards.p1.life === life - 1, `${result.state.boards.p1.life}`);
  check("คอมโบไม่จำกัด -> ยังคอมโบต่อได้", result.state.combo?.unlimited === true);

  // A card that forbade combos this turn must actually stop one.
  const blocked = structuredClone(red);
  blocked.turnLog.flags.p2 = ["noCombo"];
  const stopped = step(blocked, "p2", { kind: "combo", cardId: "BP01-044" });
  check("ธง noCombo ห้ามคอมโบจริง", stopped.error?.includes("stops you comboing") === true, stopped.error ?? "");

  const passed = step(game, "p2", { kind: "passCombo" });
  check("จบขั้นคอมโบ -> เข้าเฟสจบเทิร์น", passed.state.phase === "end" && passed.error === null);
  game = passed.state;
}

// --- End Phase and passing the turn ----------------------------------------

{
  let s = structuredClone(game);
  s.boards.p1.hand = Array.from({ length: 10 }, () => action("BP01-044"));
  const { result } = drive(s, "p1", { kind: "endTurn" });
  check("จบเทิร์น: ทิ้งการ์ดให้เหลือ 8", result.state.boards.p1.hand.length === HAND_LIMIT, `${result.state.boards.p1.hand.length}`);
  check("จบเทิร์น: ล้าง Action Area ลงกองทิ้ง", result.state.actionZone.p1.length === 0);
  check("จบเทิร์น: สลับผู้เล่น", result.state.turnPlayerId === "p2", result.state.turnPlayerId);
  check("จบเทิร์น: เลขเทิร์นเดินหน้า", result.state.turnNumber === 2);
  check("จบเทิร์น: กลับไปเฟสจั่ว", result.state.phase === "draw");
  game = result.state;

  const notYours = step(game, "p1", { kind: "endTurn" });
  check("จบเทิร์นแทนคนอื่นไม่ได้", notYours.error === "It is not your turn", notYours.error ?? "");

  const second = drive(game, "p2", { kind: "startTurn" });
  check("เทิร์นถัดไปจั่ว 2 ใบ", second.result.state.boards.p2.hand.length === game.boards.p2.hand.length + 2);
  check("ล้างบันทึกรายเทิร์น", Object.keys(second.result.state.turnLog.damageTaken).length === 0);
  check("ล้างจำนวนแอ็กชันที่ใช้ไป", second.result.state.boards.p1.actionsTakenThisTurn.length === 0);
}

// --- Win condition ---------------------------------------------------------

{
  let s = newMatch();
  s.phase = "counter";
  s.boards.p1.life = 2;
  s.boards.p1.hand = [action("BP01-044")]; // red atk 1
  s.boards.p2.hand = [action("BP01-045")]; // blue atk 3
  const c1 = step(s, "p1", { kind: "commit", cardId: "BP01-044" });
  const c2 = step(c1.state, "p2", { kind: "commit", cardId: "BP01-045" });
  const { result } = drive(c2.state, "p1", { kind: "resolveCounter" });
  check("เลือดหมด -> ประกาศผู้ชนะ", result.state.winnerId === "p2", `${result.state.winnerId}`);

  const after = step(result.state, "p2", { kind: "passCombo" });
  check("จบเกมแล้วสั่งอะไรต่อไม่ได้", after.error === "The match is already over", after.error ?? "");
}

// --- [Counter] sees the card actually being played --------------------------

{
  // BP01-010 Shorekeeper is "[Leader] [Counter] if you counter with a green
  // card, you may reveal the top card and take it". The Counter Phase happens
  // for both sides, so this fires for whoever laid the green card down — and
  // it has to read the card revealed THIS phase, not the colour of the
  // previous battle, which is what raising [Counter] before the reveal did.
  const shorekeeper = ["BP01-010", "BP01-008", "BP01-024", "BP01-027"].map(character);
  const green = requireCard("BP01-058"); // Shorekeeper, green, cost 0
  check(
    "การ์ดที่ใช้ทดสอบเป็นสีเขียวจริง",
    green.type === "action" && green.color === "green",
    green.type === "action" ? green.color : green.type
  );

  const s = createMatch({
    matchId: "counter-timing",
    startingPlayerId: "p1",
    players: [
      { playerId: "p1", characterDeck: shorekeeper, actionDeck: deck(["BP01-052"]) },
      { playerId: "p2", characterDeck: ENCORE.map(character), actionDeck: deck(P2_DECK) },
    ],
  });
  s.phase = "counter";
  s.boards.p1.hand = [action("BP01-058")]; // green
  s.boards.p2.hand = [action("BP01-044")]; // red

  const c1 = step(s, "p1", { kind: "commit", cardId: "BP01-058" });
  const c2 = step(c1.state, "p2", { kind: "commit", cardId: "BP01-044" });

  const first = step(c2.state, "p1", { kind: "resolveCounter" });
  check(
    "[Counter] ถามหลังเปิดการ์ด ไม่ใช่ก่อน",
    first.pending?.cardId === "BP01-010",
    first.pending ? first.pending.cardId : "ไม่ถามเลย"
  );
  check("ถามเจ้าของการ์ดที่ลงสีเขียว", first.pending?.playerId === "p1", first.pending?.playerId ?? "-");

  const { result } = drive(c2.state, "p1", { kind: "resolveCounter" });
  check("ตอบแล้วจบเฟสได้", result.pending === null && result.error === null, result.error ?? "");
  check(
    "ตอบตกลง -> ได้การ์ดบนสุดขึ้นมือ",
    result.state.boards.p1.hand.length === 1,
    `hand=${result.state.boards.p1.hand.length}`
  );
}

// --- The published turn order ----------------------------------------------
//
// Four rules taken from the official rules page, each of which the engine got
// wrong at some point:
//   * skills resolve turn player first, then the other player
//   * Judgment skills resolve BEFORE the damage lands
//   * costs are paid when a card is turned up, not when it is laid down
//   * a red win chains red cards only

{
  const s = newMatch();
  const order = sourcesInPlay(s, "judgement").map((source) => source.controllerId);
  const firstOther = order.findIndex((id) => id !== s.turnPlayerId);
  check(
    "สกิลทำงานเรียงจากเจ้าของเทิร์นก่อน",
    order[0] === s.turnPlayerId &&
      (firstOther < 0 || !order.slice(firstOther).includes(s.turnPlayerId)),
    order.join(",")
  );

  // Turn the turn over and the order follows it.
  const flipped = structuredClone(s);
  flipped.turnPlayerId = "p2";
  check(
    "สลับเทิร์นแล้วลำดับสลับตาม",
    sourcesInPlay(flipped, "judgement")[0]?.controllerId === "p2",
    sourcesInPlay(flipped, "judgement")[0]?.controllerId ?? "-"
  );
}

{
  // BP01-047 is "[Judgement] if you win, draw a card". Its controller must
  // still be on full Life when it resolves: the damage has not landed yet.
  let s = newMatch();
  s.phase = "counter";
  s.boards.p1.hand = [action("BP01-045")]; // blue, atk 3
  s.boards.p2.hand = [action("BP01-044")]; // red, atk 1 — blue beats red
  const c1 = step(s, "p1", { kind: "commit", cardId: "BP01-045" });
  const c2 = step(c1.state, "p2", { kind: "commit", cardId: "BP01-044" });
  const { result } = drive(c2.state, "p1", { kind: "resolveCounter" });

  const lines = result.log;
  const judgementAt = lines.findIndex((line) => line.includes("wins the clash"));
  const damageAt = lines.findIndex((line) => line.includes("takes "));
  check(
    "ตัดสินผลแพ้ชนะก่อน แล้วค่อยลงดาเมจ",
    judgementAt >= 0 && damageAt > judgementAt,
    lines.join(" | ")
  );
  check("ดาเมจเข้าจริงหลังจากนั้น", result.state.boards.p2.life === 17, `${result.state.boards.p2.life}`);
}

{
  // A red win chains red cards only.
  let s = newMatch();
  s.phase = "combo";
  s.combo = { playerId: "p1", unlimited: true, remaining: Infinity };
  s.boards.p1.hand = [action("BP01-045"), action("BP01-044")]; // blue, red
  s.boards.p1.competitionArea = [action("BP01-044"), action("BP01-044")];

  const blue = step(s, "p1", { kind: "combo", cardId: "BP01-045" });
  check("ชนะด้วยแดง -> ต่อด้วยการ์ดที่ไม่ใช่แดงไม่ได้", blue.error !== null, blue.error ?? "");

  const red = drive(s, "p1", { kind: "combo", cardId: "BP01-044" });
  check("ต่อด้วยการ์ดแดงได้", red.result.error === null, red.result.error ?? "");

  // A Follow{x} window is red-only in the same way — the colour rule is about
  // the follow-up card itself, not about where the right to chain came from.
  const follow = structuredClone(s);
  follow.combo = { playerId: "p1", unlimited: false, remaining: 2 };
  const notRed = step(follow, "p1", { kind: "combo", cardId: "BP01-045" });
  check("สิทธิ์จาก Follow{x} ก็ต้องเป็นการ์ดแดงเหมือนกัน", notRed.error !== null, notRed.error ?? "");
  const followRed = drive(follow, "p1", { kind: "combo", cardId: "BP01-044" });
  check("Follow{x} ต่อด้วยแดงได้", followRed.result.error === null, followRed.result.error ?? "");
  check(
    "และหักสิทธิ์ไป 1",
    followRed.result.state.combo?.remaining === 1,
    `${followRed.result.state.combo?.remaining}`
  );

  // Spend the rest and the window closes. This is what caught the decrement
  // writing to a stale copy of the state, which made Follow{x} unlimited.
  let spending = followRed.result.state;
  spending.boards.p1.hand = [action("BP01-044"), action("BP01-044")];
  spending.boards.p1.competitionArea = [action("BP01-044"), action("BP01-044")];
  const second = drive(spending, "p1", { kind: "combo", cardId: "BP01-044" }).result;
  check("ใช้สิทธิ์ที่สอง -> เหลือ 0", second.state.combo?.remaining === 0, `${second.state.combo?.remaining}`);
  const third = step(second.state, "p1", { kind: "combo", cardId: "BP01-044" });
  check("สิทธิ์หมดแล้ว -> ต่อไม่ได้", third.error === "No follow-ups left", third.error ?? "");
}

// --- Hidden information ----------------------------------------------------

{
  const s = newMatch();
  const view = viewFor(s, "p1");
  check("มุมมองผู้เล่น: เห็นมือตัวเอง", view.boards.p1.hand.length === 5);
  // Hidden, but still counted: how many cards someone holds is public.
  check(
    "มุมมองผู้เล่น: มือฝ่ายตรงข้ามเป็นการ์ดคว่ำ",
    view.boards.p2.hand.length === 5 &&
      view.boards.p2.hand.every((card) => card.id.startsWith(HIDDEN_CARD_ID)),
    view.boards.p2.hand.map((card) => card.id).join(",")
  );
  check(
    "มุมมองผู้เล่น: ไม่เห็นชื่อการ์ดในมือฝ่ายตรงข้าม",
    view.boards.p2.hand.every((card) => card.name === "")
  );
  check(
    "มุมมองผู้เล่น: เด็คฝ่ายตรงข้ามนับได้แต่ดูไม่ได้",
    view.boards.p2.actionDeck.length === s.boards.p2.actionDeck.length &&
      view.boards.p2.actionDeck.every((card) => card.id.startsWith(HIDDEN_CARD_ID))
  );
  check("มุมมองผู้เล่น: ของจริงไม่ถูกแก้", s.boards.p2.hand.length === 5);
  check(
    "มุมมองผู้เล่น: มือตัวเองยังเป็นการ์ดจริง",
    view.boards.p1.hand.every((card) => !card.id.startsWith(HIDDEN_CARD_ID))
  );
}

// การ์ดที่คว่ำไว้ต้องเห็นว่า "มี" แต่ไม่เห็นว่าเป็นใบไหน
{
  let s = newMatch();
  s = step(s, "p1", { kind: "startTurn" }).state;
  const committed = s.boards.p1.hand[0];
  s = step(s, "p1", { kind: "commit", cardId: committed.id }).state;

  const mine = viewFor(s, "p1");
  const theirs = viewFor(s, "p2");
  check("การ์ดคว่ำ: เจ้าของเห็นว่าเป็นใบไหน", mine.facedown.p1?.id === committed.id);
  check(
    "การ์ดคว่ำ: อีกฝ่ายเห็นว่ามีการ์ดคว่ำ แต่ไม่รู้ว่าใบไหน",
    theirs.facedown.p1?.id.startsWith(HIDDEN_CARD_ID) === true,
    String(theirs.facedown.p1?.id)
  );
}

// --- What the UI may offer -------------------------------------------------

{
  const s = newMatch();
  check("เฟสจั่ว: สั่งได้แค่เริ่มเทิร์น", legalIntents(s, "p1").join(",") === "startTurn");
  check("ไม่ใช่เทิร์นตัวเอง: สั่งอะไรไม่ได้", legalIntents(s, "p2").length === 0);

  const started = drive(s, "p1", { kind: "startTurn" }).result.state;
  const kinds = legalIntents(started, "p1");
  check(
    "เฟสแอ็กชัน: ลงการ์ดได้ และเหลือแอ็กชันครบ 3 แบบ",
    kinds.includes("commit") && kinds.includes("charge") && kinds.includes("levelUp") && kinds.includes("switch"),
    kinds.join(",")
  );
}

// --- Continuous effects must not DO anything --------------------------------
//
// recomputeContinuous throws away everything continuous effects produced and
// rebuilds it from the board, which is what makes it safe to call whenever
// anything moves. That only holds while continuous effects are limited to
// producing things. A one-shot in that list — deal 1 damage, draw a card —
// fires again on every rebuild, which is every level up, charge and switch
// for the rest of the game.
//
// This caught a real bug: "[Leader] [Counter] deal 1 damage" was classified
// as continuous because `leader` came first in its condition, so after one
// red counter the opponent quietly bled a point per board change until the
// game ended with life below zero.

{
  // Jinshi leads: BP01-030 Lv.0 is "[Leader] [Counter] if you counter with a
  // red card, deal 1 damage", BP01-029 Lv.1 "[Leader] [Judgement] if you win
  // with a red card, deal 2".
  const jinshi = ["BP01-030", "BP01-029", "BP01-024", "BP01-027"].map(character);
  let s = createMatch({
    matchId: "continuous-idempotence",
    startingPlayerId: "p1",
    players: [
      { playerId: "p1", characterDeck: jinshi, actionDeck: deck(["BP01-044"]) },
      { playerId: "p2", characterDeck: ENCORE.map(character), actionDeck: deck(P2_DECK) },
    ],
  });
  s.phase = "counter";
  s.boards.p1.hand = [action("BP01-044")]; // red
  s.boards.p2.hand = [action("BP01-052")];

  s = step(s, "p1", { kind: "commit", cardId: "BP01-044" }).state;
  s = step(s, "p2", { kind: "commit", cardId: "BP01-052" }).state;
  const { result } = drive(s, "p1", { kind: "resolveCounter" });
  s = result.state;

  const afterClash = s.boards.p2.life;
  check("ปะทะจบแล้วเลือดลดลงจริง", afterClash < 20, `20 -> ${afterClash}`);

  // The clash is over and lastBattle still says "p1 countered with red",
  // which is exactly the state that used to keep paying out.
  let rebuilt = s;
  for (let i = 0; i < 10; i += 1) rebuilt = recomputeContinuous(rebuilt).state;
  check(
    "คำนวณเอฟเฟคต่อเนื่องซ้ำ 10 รอบ เลือดไม่ขยับ",
    rebuilt.boards.p2.life === afterClash && rebuilt.boards.p1.life === s.boards.p1.life,
    `p2 ${afterClash} -> ${rebuilt.boards.p2.life}`
  );
  check(
    "และไม่มีใครถูกจั่วการ์ดเพิ่ม",
    rebuilt.boards.p1.hand.length === s.boards.p1.hand.length &&
      rebuilt.boards.p2.hand.length === s.boards.p2.hand.length
  );

  // The contract in one assertion: a second rebuild changes nothing a first
  // one did not.
  const once = recomputeContinuous(s).state;
  const twice = recomputeContinuous(once).state;
  check("คำนวณสองรอบได้ผลเท่ากับรอบเดียว", JSON.stringify(once) === JSON.stringify(twice));

  // The fix must not have silenced these abilities instead — they still have
  // to fire once, through their own trigger. Two separate hits land here: the
  // [Counter] ability, then the clash itself.
  const hits = result.log.filter((line) => line.includes("p2 takes"));
  check(
    "เอฟเฟค [Counter] ยังทำงานตอนเทรกเกอร์จริง ไม่ได้ถูกปิดไปด้วย",
    hits.length === 2,
    hits.join(" | ")
  );
}

// แอ็กชันที่ไม่ใช่การโจมตี ต้องไม่ทำให้ใครเสียเลือด
{
  let s = newMatch();
  s = step(s, "p1", { kind: "startTurn" }).state;
  const before = { p1: s.boards.p1.life, p2: s.boards.p2.life };

  // Charge and Level Up both rebuild the continuous layer. Neither is an
  // attack, so nobody may lose life across them.
  const charged = step(s, "p1", { kind: "charge", cardIds: [s.boards.p1.hand[0].id] });
  s = charged.error ? s : charged.state;
  const target = s.boards.p1.characterPool.find((c) => c.level === 1);
  if (target) {
    const levelled = step(s, "p1", {
      kind: "levelUp",
      characterId: target.id,
      discardIds: [s.boards.p1.hand[0].id],
    });
    s = levelled.error ? s : levelled.state;
  }

  check(
    "ชาร์จ/เลเวลอัป ไม่ทำให้ใครเสียเลือด",
    s.boards.p1.life === before.p1 && s.boards.p2.life === before.p2,
    `p1 ${before.p1}->${s.boards.p1.life}  p2 ${before.p2}->${s.boards.p2.life}`
  );
}


// --- "[Counter] if you counter with X" reads YOUR card, this clash ----------
//
// BP01-030 Jinshi Lv.0: "[Leader] [Counter] if you counter with a red card,
// deal 1 damage". The Counter Phase happens for both sides, so the ability is
// raised for both — but the card it asks about is the controller's own, and
// only the one revealed right now. Playing no card means countering with
// nothing, however red the card you played last turn was.

{
  const jinshi = ["BP01-030", "BP01-029", "BP01-024", "BP01-027"].map(character);
  let s = createMatch({
    matchId: "counter-colour",
    startingPlayerId: "p1",
    players: [
      { playerId: "p1", characterDeck: jinshi, actionDeck: deck(["BP01-044"]) },
      { playerId: "p2", characterDeck: ENCORE.map(character), actionDeck: deck(["BP01-044"]) },
    ],
  });
  s.phase = "counter";
  s.boards.p1.hand = [action("BP01-044")]; // red
  s.boards.p2.hand = [action("BP01-045")]; // blue

  s = step(s, "p1", { kind: "commit", cardId: "BP01-044" }).state;
  s = step(s, "p2", { kind: "commit", cardId: "BP01-045" }).state;
  const first = drive(s, "p1", { kind: "resolveCounter" }).result;
  s = first.state;
  check(
    "counter ด้วยแดงเอง -> เอฟเฟคทำงาน",
    first.log.some((line) => line.includes("p2 takes 1 from Jinshi")),
    first.log.filter((line) => line.includes("takes")).join(" | ")
  );

  // Round two: p1 lays nothing down, p2 counters with red. p1's Jinshi must
  // stay quiet — p1 countered with nothing at all.
  s = step(s, "p1", { kind: "passCombo" }).state;
  s = step(s, "p1", { kind: "endTurn" }).state;
  s = step(s, "p2", { kind: "startTurn" }).state;
  s.boards.p2.hand = [action("BP01-044")]; // red
  s = step(s, "p2", { kind: "commit", cardId: "BP01-044" }).state;
  s = step(s, "p1", { kind: "pass" }).state;

  const before = s.boards.p2.life;
  const second = drive(s, "p2", { kind: "resolveCounter" }).result;
  check(
    "ไม่ได้ลงการ์ด แต่อีกฝ่ายลงแดง -> Jinshi ของเราต้องไม่ทำงาน",
    !second.log.some((line) => line.includes("from Jinshi")),
    second.log.filter((line) => line.includes("takes")).join(" | ")
  );
  check(
    "และอีกฝ่ายต้องไม่เสียเลือดจากเอฟเฟคของเรา",
    second.state.boards.p2.life === before,
    `p2 ${before} -> ${second.state.boards.p2.life}`
  );
}

// --- The log says what took the Life, and which card ------------------------

{
  const jinshi = ["BP01-030", "BP01-029", "BP01-024", "BP01-027"].map(character);
  let s = createMatch({
    matchId: "damage-source",
    startingPlayerId: "p1",
    players: [
      { playerId: "p1", characterDeck: jinshi, actionDeck: deck(["BP01-044"]) },
      { playerId: "p2", characterDeck: ENCORE.map(character), actionDeck: deck(P2_DECK) },
    ],
  });
  s.phase = "counter";
  s.boards.p1.hand = [action("BP01-044")];
  s.boards.p2.hand = [action("BP01-052")];
  s = step(s, "p1", { kind: "commit", cardId: "BP01-044" }).state;
  s = step(s, "p2", { kind: "commit", cardId: "BP01-052" }).state;
  const out = drive(s, "p1", { kind: "resolveCounter" }).result;

  const hits = out.log.filter((line) => line.includes(" takes "));
  check("มีบรรทัดดาเมจอย่างน้อย 2 บรรทัด", hits.length >= 2, hits.join(" | "));
  check(
    "ทุกบรรทัดบอกว่ามาจากการ์ดใบไหน",
    hits.every((line) => / from .+ \[[A-Z]{2}\d{2}-\d{3}\] /.test(line)),
    hits.join(" | ")
  );
  check(
    "ดาเมจจากเอฟเฟคบอกชื่อตัวละคร",
    hits.some((line) => line.includes("from Jinshi [BP01-030]")),
    hits.join(" | ")
  );
  check(
    "ดาเมจจากการปะทะบอกชื่อการ์ดที่ชนะ",
    hits.some((line) => /from .+ \[BP01-0(44|52)\]/.test(line)),
    hits.join(" | ")
  );
}


console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
