// Checks the turn-structure rules.
// Run with: npm run test:rules
import type { ActionCard, CharacterCard, MatchState, PlayerBoard } from "../src/game";
import { emptyMatchState } from "../src/game";
import { MAX_CHARACTER_LEVEL } from "../src/game";
import {
  ACTION_DECK_SIZE,
  ACTION_KINDS,
  MAX_ACTIONS_PER_TURN,
  applyEndPhase,
  canLevelUpOnto,
  canTakeAction,
  checkWinner,
  drawCount,
  levelUpCost,
  nextPhase,
  recordCardPlayed,
  recordDamage,
  resetTurnLog,
  validateDecks,
} from "../src/rules";

function card(id: string): ActionCard {
  return { id, name: id, color: "red", cost: 0, damage: 1, speed: 1, imageId: id };
}
function chara(name: string, level: 0 | 1 | 2): CharacterCard {
  return { id: `${name}-${level}`, name, level, imageId: `${name}-${level}` };
}
function board(playerId: string, handSize = 5): PlayerBoard {
  return {
    playerId,
    life: 20,
    leader: { position: "leader", card: chara("Jiyan", 0), under: [] },
    back: [],
    characterPool: [],
    // A deck, because "no deck AND no trash" is now a loss condition on its own
    // — a fixture with both empty would start every case already decided.
    actionDeck: Array.from({ length: 10 }, (_, i) => card(`${playerId}-d${i}`)),
    hand: Array.from({ length: handSize }, (_, i) => card(`${playerId}-h${i}`)),
    competitionArea: [],
    trash: [],
    actionsTakenThisTurn: [],
  };
}
function state(handSize = 5): MatchState {
  return {
    ...emptyMatchState("m1", ["p1", "p2"]),
    phase: "end",
    boards: { p1: board("p1", handSize), p2: board("p2") },
    actionZone: { p1: [card("revealed-1"), card("revealed-2")], p2: [] },
  }
}

const results: { name: string; pass: boolean; detail: string }[] = [];
const check = (name: string, pass: boolean, detail = "") => results.push({ name, pass, detail });

// deck legality
{
  const ok = validateDecks(new Array(3).fill(0), new Array(ACTION_DECK_SIZE).fill(0));
  const small = validateDecks(new Array(2).fill(0), new Array(39).fill(0));
  const big = validateDecks(new Array(16).fill(0), new Array(ACTION_DECK_SIZE).fill(0));
  check("เด็คถูกกฎ ผ่าน", ok.length === 0);
  check("เด็คตัวละครน้อยไป + แอ็กชันไม่ครบ 40 -> 2 ปัญหา", small.length === 2, small.map((i) => i.message).join(" | "));
  check("เด็คตัวละครเกิน 15 -> ไม่ผ่าน", big.length === 1, big[0]?.message);
}

// draw counts
{
  check("เทิร์นแรก คนเริ่มจั่ว 1", drawCount(1, true) === 1);
  check("เทิร์นแรก อีกฝ่ายจั่ว 2", drawCount(1, false) === 2);
  check("เทิร์นหลังจากนั้นจั่ว 2", drawCount(2, true) === 2 && drawCount(5, false) === 2);
}

// phase order
{
  const seen: string[] = ["draw"];
  let phase = nextPhase("draw");
  while (phase) {
    seen.push(phase);
    phase = nextPhase(phase);
  }
  check(
    "ลำดับเฟสครบและจบที่ end",
    seen.join(">") === "draw>action>counter>combo>end",
    seen.join(">")
  );
}

// action limits
{
  const b = board("p1");
  check("ยังไม่ทำอะไร charge ได้", canTakeAction(b, "charge").ok);
  b.actionsTakenThisTurn.push("charge");
  check("charge ซ้ำในเทิร์นเดียวไม่ได้", !canTakeAction(b, "charge").ok, canTakeAction(b, "charge").reason);
  check("แต่ levelUp ยังได้", canTakeAction(b, "levelUp").ok);
  b.actionsTakenThisTurn.push("levelUp", "switch");
  check(
    "ครบ 3 ครั้งแล้ว ทำอะไรไม่ได้อีก",
    !canTakeAction(b, "charge").ok,
    canTakeAction(b, "charge").reason
  );
}

// the two action rules agree with each other
{
  const b = board("p1");
  for (const kind of ACTION_KINDS) b.actionsTakenThisTurn.push(kind);
  check(
    "ใช้ครบทุกชนิดแล้วพอดีเพดาน 3 ครั้ง",
    MAX_ACTIONS_PER_TURN === ACTION_KINDS.length && b.actionsTakenThisTurn.length === MAX_ACTIONS_PER_TURN,
    `kinds=${ACTION_KINDS.length} max=${MAX_ACTIONS_PER_TURN}`
  );
  check(
    "ทำซ้ำชนิดเดิมไม่ได้ ทุกชนิด",
    ACTION_KINDS.every((kind) => !canTakeAction(b, kind).ok)
  );
}

// level up
{
  check("ค่าเลเวลอัป = เลเวลปลายทาง", levelUpCost(1) === 1 && levelUpCost(2) === 2);
  check("เพดานเลเวลคือ 2", MAX_CHARACTER_LEVEL === 2);

  const b = board("p1", 5);
  check("0 -> 1 ได้", canLevelUpOnto(chara("Jiyan", 0), chara("Jiyan", 1), b).ok);
  check("1 -> 1 ได้ (เท่าเดิม)", canLevelUpOnto(chara("Jiyan", 1), chara("Jiyan", 1), b).ok);
  check("1 -> 2 ได้", canLevelUpOnto(chara("Jiyan", 1), chara("Jiyan", 2), b).ok);
  check("2 -> 2 ได้ (เท่าเดิม)", canLevelUpOnto(chara("Jiyan", 2), chara("Jiyan", 2), b).ok);
  check(
    "0 -> 2 ไม่ได้ (ข้ามเลเวล)",
    !canLevelUpOnto(chara("Jiyan", 0), chara("Jiyan", 2), b).ok,
    canLevelUpOnto(chara("Jiyan", 0), chara("Jiyan", 2), b).reason
  );
  check(
    "2 -> 1 ไม่ได้ (ลดเลเวล)",
    !canLevelUpOnto(chara("Jiyan", 2), chara("Jiyan", 1), b).ok,
    canLevelUpOnto(chara("Jiyan", 2), chara("Jiyan", 1), b).reason
  );
  check(
    "คนละตัวละครไม่ได้",
    !canLevelUpOnto(chara("Jiyan", 0), chara("Encore", 1), b).ok,
    canLevelUpOnto(chara("Jiyan", 0), chara("Encore", 1), b).reason
  );
  check(
    "การ์ดในมือไม่พอจ่ายค่าเลเวลอัป ไม่ได้",
    !canLevelUpOnto(chara("Jiyan", 1), chara("Jiyan", 2), board("p1", 1)).ok,
    canLevelUpOnto(chara("Jiyan", 1), chara("Jiyan", 2), board("p1", 1)).reason
  );
}

// end phase
{
  const s = state(11);
  s.boards.p1.actionsTakenThisTurn = ["charge", "switch"];
  const after = applyEndPhase(s, "p1");
  const p1 = after.boards.p1;
  check("จบเทิร์น ล้าง Action Area", after.actionZone.p1.length === 0);
  check(
    "การ์ดที่เปิดไปลงหลุมทิ้ง",
    p1.trash.some((c) => c.id === "revealed-1") && p1.trash.some((c) => c.id === "revealed-2")
  );
  check("ทิ้งการ์ดให้เหลือ 8 ใบ", p1.hand.length === 8, `hand=${p1.hand.length}`);
  check("การ์ดส่วนเกิน 3 ใบไปกองทิ้ง", p1.trash.length === 5, `trash=${p1.trash.length}`);
  check("ล้างจำนวนแอ็กชันที่ใช้ไป", p1.actionsTakenThisTurn.length === 0);

  const under = applyEndPhase(state(5), "p1");
  check("มือไม่เกิน 8 ไม่ต้องทิ้ง", under.boards.p1.hand.length === 5);
}

// win condition
{
  const alive = state();
  check("ยังไม่มีใครแพ้", checkWinner(alive) === null);

  const dead = state();
  dead.boards.p2.life = 0;
  check("Life เหลือ 0 -> อีกฝ่ายชนะ", checkWinner(dead) === "p1", String(checkWinner(dead)));

  const negative = state();
  negative.boards.p1.life = -3;
  check("Life ติดลบก็แพ้", checkWinner(negative) === "p2", String(checkWinner(negative)));

  const both = state();
  both.boards.p1.life = 0;
  both.boards.p2.life = 0;
  check("ศูนย์พร้อมกัน -> เสมอ", checkWinner(both) === "draw", String(checkWinner(both)));

  // The second loss condition: nothing left to draw from AND nothing left to
  // rebuild from. An empty deck on its own is not it — the trash is shuffled
  // back in first.
  const deckOut = state();
  deckOut.boards.p2.actionDeck = [];
  check(
    "เด็คหมดแต่กองทิ้งยังมี -> ยังไม่แพ้",
    ((deckOut.boards.p2.trash = [card("t1")]), checkWinner(deckOut) === null),
    String(checkWinner(deckOut))
  );

  const outOfCards = state();
  outOfCards.boards.p2.actionDeck = [];
  outOfCards.boards.p2.trash = [];
  check(
    "เด็คหมดและกองทิ้งว่าง -> แพ้",
    checkWinner(outOfCards) === "p1",
    String(checkWinner(outOfCards))
  );

  const bothOut = state();
  for (const id of ["p1", "p2"] as const) {
    bothOut.boards[id].actionDeck = [];
    bothOut.boards[id].trash = [];
  }
  check("หมดการ์ดทั้งคู่ -> เสมอ", checkWinner(bothOut) === "draw", String(checkWinner(bothOut)));
}

// end phase: the hand limit is the turn player's alone
{
  const s = state(11);
  const forEveryone = applyEndPhase(s, "p1", undefined, { discardToLimit: false });
  check(
    "ฝ่ายที่ไม่ใช่เจ้าของเทิร์น มือเกิน 8 ก็ไม่ต้องทิ้ง",
    forEveryone.boards.p1.hand.length === 11,
    `hand=${forEveryone.boards.p1.hand.length}`
  );
  check(
    "แต่ Action Area ยังโดนล้างตามกติกา",
    forEveryone.actionZone.p1.length === 0
  );
}

// turn log lifecycle
{
  const s0 = state();
  const played = recordCardPlayed(s0, "p1", card("x1"));
  const hurt = recordDamage(played, "p2", 4);
  check("บันทึกการ์ดที่เล่นไปในเทิร์น", hurt.turnLog.cardsPlayed.p1?.length === 1);
  check("บันทึกดาเมจที่เกิดนอกเอฟเฟค", hurt.turnLog.damageTaken.p2 === 4);
  check("ของเดิมไม่ถูกแก้ (pure)", s0.turnLog.cardsPlayed.p1 === undefined);

  const cleared = resetTurnLog(hurt);
  check(
    "ขึ้นเทิร์นใหม่ ล้างสมุดบันทึก",
    Object.keys(cleared.turnLog.cardsPlayed).length === 0 &&
      Object.keys(cleared.turnLog.damageTaken).length === 0,
    JSON.stringify(cleared.turnLog)
  );
}

let failed = 0;
for (const r of results) {
  if (!r.pass) failed += 1;
  console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.detail ? `  [${r.detail}]` : ""}`);
}
console.log(`\n${results.length - failed}/${results.length} passed`);
if (failed > 0) process.exit(1);
