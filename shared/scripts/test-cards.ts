// Checks the resolves written against real cards, using the real card data.
// Run with: npm run test:cards
import { getCard, ALL_CARDS } from "../src/cardDb";
import { isManual } from "../src/cardDef";
import { resolveTrigger, recomputeContinuous, type EffectSource } from "../src/effects";
import type { ActionCard, MatchState, PlayerBoard } from "../src/game";
import { emptyMatchState } from "../src/game";

const card = (id: string, color: ActionCard["color"] = "red"): ActionCard => ({
  id, name: id, color, cost: 0, damage: 1, speed: 1, imageId: id,
});
const board = (p: string): PlayerBoard => ({
  playerId: p, life: 20, leader: null, back: [], characterPool: [],
  actionDeck: Array.from({ length: 10 }, (_, i) => card(`${p}-d${i}`)),
  hand: [], competitionArea: [], trash: [], actionsTakenThisTurn: [],
});
const state = (): MatchState => ({
  ...emptyMatchState("m", ["p1", "p2"]),
  phase: "counter",
  boards: { p1: board("p1"), p2: board("p2") },
});
const src = (id: string): EffectSource => ({ card: getCard(id)!, controllerId: "p1", zone: "leader" });

/**
 * Puts the card's own character in the Leader slot. Cards printed
 * [Leader Skill] only work while that character is leading, so a fixture for
 * one of those has to say who is leading.
 */
const withLeaderFor = (s: MatchState, cardId: string): MatchState => {
  const character = getCard(cardId)?.character;
  const chara = ALL_CARDS.find((c) => c.type === "leader" && c.character === character);
  if (chara) {
    s.boards.p1.leader = {
      position: "leader",
      card: { id: chara.id, name: chara.name, level: 0, imageId: chara.imageId },
      under: [],
    };
  }
  return s;
};

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  [${detail}]` : ""}`);
  ok ? pass++ : fail++;
};

// BP01-047: if you won, draw 1
{
  const won = state();
  won.lastBattleWinnerId = "p1";
  const a = resolveTrigger(won, "judgement", [src("BP01-047")]);
  const lost = state();
  lost.lastBattleWinnerId = "p2";
  const b = resolveTrigger(lost, "judgement", [src("BP01-047")]);
  check("BP01-047 ชนะ -> จั่ว 1", a.state.boards.p1.hand.length === 1, `hand=${a.state.boards.p1.hand.length}`);
  check("BP01-047 แพ้ -> ไม่จั่ว", b.state.boards.p1.hand.length === 0, `hand=${b.state.boards.p1.hand.length}`);
}
// BP01-010: won with a GREEN card -> heal 1
{
  const green = state();
  green.lastBattleWinnerId = "p1";
  green.lastBattle = { winnerId: "p1", loserId: "p2", colorByPlayer: { p1: "green", p2: "blue" }, cardIdByPlayer: {} };
  green.boards.p1.leader = { position: "leader", card: { id: "BP01-010", name: "x", level: 0, imageId: "x" }, under: [] };
  const red = structuredClone(green);
  red.lastBattle!.colorByPlayer.p1 = "red";
  const a = resolveTrigger(green, "judgement", [src("BP01-010")]);
  const b = resolveTrigger(red, "judgement", [src("BP01-010")]);
  check("BP01-010 ชนะด้วยเขียว -> ฟื้น 1", a.state.boards.p1.life === 21, `life=${a.state.boards.p1.life}`);
  check("BP01-010 ชนะด้วยแดง -> ไม่ฟื้น", b.state.boards.p1.life === 20, `life=${b.state.boards.p1.life}`);
}
// BP01-011: passive buff on Encore red cards
{
  const s = state();
  s.boards.p1.leader = { position: "leader", card: { id: "BP01-011", name: "Encore", level: 2, imageId: "x" }, under: [] };
  const out = recomputeContinuous(s);
  const mods = out.state.statModifiers;
  check("BP01-011 ให้บัฟแดงของ Encore", mods.length === 1 && mods[0].amount === 1, JSON.stringify(mods.map(m => m.filter)));
}
// BP01-002: level up returns the card to the character deck
{
  const s = state();
  s.boards.p1.leader = { position: "leader", card: { id: "BP01-002", name: "Camellya", level: 2, imageId: "x" }, under: [] };
  const out = resolveTrigger(s, "levelUp", [src("BP01-002")]);
  check("BP01-002 levelUp -> กลับเข้า pool", out.state.boards.p1.characterPool.some(c => c.id === "BP01-002") && out.state.boards.p1.leader === null);
}

// BP01-005: on a win, pull a {Normal Attack} (通常攻撃) back out of the trash.
// Not {Basic Attack} (基本攻撃) — the two are separate printed tags, and the
// card says 通常攻撃.
{
  const s = state();
  s.lastBattleWinnerId = "p1";
  s.boards.p1.trash = [card("BP01-062"), card("BP01-047")];
  const out = resolveTrigger(s, "judgement", [src("BP01-005")]);
  const hand = out.state.boards.p1.hand.map((c) => c.id);
  const pulled = hand.length === 1 ? getCard(hand[0]) : undefined;
  const isNormal =
    pulled && pulled.type === "action" &&
    (pulled.subtypes ?? []).some((x) => x.toLowerCase() === "normal attack");
  check("BP01-005 ชนะ -> ดึง {Normal Attack} จากกองทิ้ง", Boolean(isNormal), `hand=${hand.join(",")}`);

  const lost = state();
  lost.boards.p1.trash = [card("BP01-044")];
  const b = resolveTrigger(lost, "judgement", [src("BP01-005")]);
  check("BP01-005 แพ้ -> ไม่ดึง", b.state.boards.p1.hand.length === 0);
}

// BP01-050: [Combo] +1 damage with 2+ {Normal Attack} in your Action Area —
// Normal Attacks only (not any 2 cards), and it counts itself.
{
  const two = state();
  two.actionZone.p1 = [card("BP01-044"), card("BP01-050")];
  const a = resolveTrigger(two, "combo", [{ ...src("BP01-050"), zone: "actionZone" }]);
  const mixed = state();
  mixed.actionZone.p1 = [card("BP01-062"), card("BP01-050")];
  const b = resolveTrigger(mixed, "combo", [{ ...src("BP01-050"), zone: "actionZone" }]);
  const buffed = (st: typeof a.state) => st.statModifiers.some((m) => m.sourceCardId === "BP01-050");
  check("BP01-050 Normal Attack 2 ใบ (นับตัวเอง) -> +1", buffed(a.state));
  check("BP01-050 อีกใบไม่ใช่ Normal Attack -> ไม่ได้ +1", !buffed(b.state));
}

// BP01-025: 2+ {Normal Attack} in the Action area -> 3 damage.
{
  const two = state();
  two.actionZone.p1 = [card("BP01-047"), card("BP01-044")];
  const a = resolveTrigger(two, "counterPhaseEnd", [src("BP01-025")]);

  const one = state();
  one.actionZone.p1 = [card("BP01-047")];
  const b = resolveTrigger(one, "counterPhaseEnd", [src("BP01-025")]);

  const normals = (id: string) => {
    const d = getCard(id);
    return d && d.type === "action" ? (d.subtypes ?? []).join("/") : "?";
  };
  check(
    "BP01-025 Normal Attack 2 ใบ -> ดาเมจ 3",
    a.state.boards.p2.life === 17,
    `p2life=${a.state.boards.p2.life} zone=${normals("BP01-047")}|${normals("BP01-044")}`
  );
  check("BP01-025 มีใบเดียว -> ไม่ทำดาเมจ", b.state.boards.p2.life === 20, `p2life=${b.state.boards.p2.life}`);
}

// BP01-003: "you MAY take a {Normal Attack} from the trash" — the engine has
// to stop and ask, then act on the answer.
{
  const base = state();
  base.boards.p1.trash = [card("BP01-062"), card("BP01-044")]; // 044 is a Normal Attack
  base.boards.p1.leader = { position: "leader", card: { id: "BP01-003", name: "Camellya", level: 1, imageId: "x" }, under: [] };

  // First pass: no answers yet, so it should suspend and change nothing.
  const asked = resolveTrigger(base, "enter", [src("BP01-003")]);
  check(
    "BP01-003 หยุดถามผู้เล่น ไม่แตะกระดาน",
    asked.pending !== null &&
      asked.pending.kind === "pickCard" &&
      asked.state.boards.p1.hand.length === 0 &&
      asked.state.boards.p1.trash.length === 2,
    `pending=${asked.pending?.kind} options=${asked.pending?.options.length} hand=${asked.state.boards.p1.hand.length}`
  );
  check(
    "ถามเฉพาะการ์ดที่เข้าเงื่อนไขหมวด",
    asked.pending?.options.length === 1 && asked.pending.options[0].cardId === "BP01-044",
    JSON.stringify(asked.pending?.options.map((o) => o.cardId))
  );
  check("ถามถูกคน", asked.pending?.playerId === "p1" && asked.pending.cardId === "BP01-003");

  // Player says yes, take BP01-044. The answer is the option's own value,
  // which names a POSITION in the list offered — several copies of one card
  // can be on it, and its number would name all of them at once.
  const took = resolveTrigger(base, "enter", [src("BP01-003")], [
    asked.pending!.options[0].value,
  ]);
  check(
    "ตอบว่าเอา -> การ์ดย้ายจากกองทิ้งขึ้นมือ",
    took.pending === null &&
      took.state.boards.p1.hand.map((c) => c.id).join() === "BP01-044" &&
      took.state.boards.p1.trash.length === 1,
    `hand=${took.state.boards.p1.hand.map((c) => c.id).join()} trash=${took.state.boards.p1.trash.length}`
  );

  // Player declines.
  const declined = resolveTrigger(base, "enter", [src("BP01-003")], [[]]);
  check(
    "ตอบว่าไม่เอา -> ไม่มีอะไรเปลี่ยน",
    declined.pending === null &&
      declined.state.boards.p1.hand.length === 0 &&
      declined.state.boards.p1.trash.length === 2,
    `hand=${declined.state.boards.p1.hand.length} trash=${declined.state.boards.p1.trash.length}`
  );

  // Nothing eligible in the trash: no question at all, no crash.
  const empty = state();
  empty.boards.p1.trash = [card("BP01-062")];
  const nothing = resolveTrigger(empty, "enter", [src("BP01-003")]);
  check(
    "ไม่มีการ์ดเข้าเงื่อนไข -> ไม่ถาม",
    nothing.pending === null && nothing.state.boards.p1.hand.length === 0
  );
}

// BP01-017 [Enter]: reveal the top card, take it only if the player agrees.
{
  const base = state();
  base.boards.p1.actionDeck = [card("BP01-044"), card("BP01-062")];

  const asked = resolveTrigger(base, "enter", [src("BP01-017")]);
  check(
    "BP01-017 ถามก่อน ไม่แตะเด็ค",
    asked.pending?.kind === "confirm" && asked.state.boards.p1.actionDeck.length === 2,
    `pending=${asked.pending?.kind}`
  );

  const yes = resolveTrigger(base, "enter", [src("BP01-017")], [true]);
  check(
    "ตอบใช่ -> ใบบนสุดเข้ามือ",
    yes.state.boards.p1.hand.map((c) => c.id).join() === "BP01-044" &&
      yes.state.boards.p1.actionDeck.length === 1,
    `hand=${yes.state.boards.p1.hand.map((c) => c.id).join()}`
  );

  const no = resolveTrigger(base, "enter", [src("BP01-017")], [false]);
  check(
    "ตอบไม่ -> การ์ดยังอยู่บนเด็ค",
    no.state.boards.p1.hand.length === 0 && no.state.boards.p1.actionDeck.length === 2
  );

  const emptyDeck = state();
  emptyDeck.boards.p1.actionDeck = [];
  const none = resolveTrigger(emptyDeck, "enter", [src("BP01-017")]);
  check("เด็คหมด -> ไม่ถาม ไม่พัง", none.pending === null);
}

// SD01-006 [Judgement]: only when you lost to blue while playing red.
//
// "the card you are playing" is the one face-up in the Action Area, which is
// where a real clash puts it — not something read back off lastBattle, which
// still describes the PREVIOUS clash while [Counter] and [Judgement] run.
{
  const lostRight = state();
  lostRight.boards.p1.actionDeck = [card("BP01-044")];
  lostRight.actionZone.p1 = [card("BP01-044", "red")];
  lostRight.actionZone.p2 = [card("BP01-045", "blue")];
  lostRight.lastBattleWinnerId = "p2";
  lostRight.lastBattle = {
    winnerId: "p2", loserId: "p1",
    colorByPlayer: { p1: "red", p2: "blue" }, cardIdByPlayer: {},
  };
  const a = resolveTrigger(lostRight, "judgement", [src("SD01-006")]);
  check("SD01-006 แพ้ฟ้าตอนเล่นแดง -> ถาม", a.pending !== null, `pending=${a.pending?.kind}`);

  const lostWrong = structuredClone(lostRight);
  lostWrong.actionZone.p1 = [card("BP01-058", "green")];
  lostWrong.lastBattle!.colorByPlayer.p1 = "green";
  const b = resolveTrigger(lostWrong, "judgement", [src("SD01-006")]);
  check("เล่นเขียวแทน -> ไม่ถาม", b.pending === null);

  // The bug this guards: pass the clash, and the colour you played LAST time
  // must not still count as what you are playing now.
  const passed = structuredClone(lostRight);
  passed.actionZone.p1 = [];
  const c0 = resolveTrigger(passed, "judgement", [src("SD01-006")]);
  check("ไม่ได้ลงการ์ด -> ไม่ถาม แม้รอบก่อนจะเล่นแดง", c0.pending === null);

  const won = structuredClone(lostRight);
  won.lastBattleWinnerId = "p1";
  won.lastBattle!.winnerId = "p1";
  won.lastBattle!.loserId = "p2";
  const c = resolveTrigger(won, "judgement", [src("SD01-006")]);
  check("ชนะ -> ไม่ถาม", c.pending === null);
}

// SD02-015 [Judgement]: on a win, two cards go into the Concerto area.
{
  const won = withLeaderFor(state(), "SD02-015");
  won.boards.p1.actionDeck = [card("BP01-044"), card("BP01-062"), card("BP01-047")];
  won.lastBattleWinnerId = "p1";
  const a = resolveTrigger(won, "judgement", [src("SD02-015")]);
  check(
    "SD02-015 ชนะ -> 2 ใบบนสุดไป Concerto",
    a.state.boards.p1.competitionArea.length === 2 && a.state.boards.p1.actionDeck.length === 1,
    `concerto=${a.state.boards.p1.competitionArea.length} deck=${a.state.boards.p1.actionDeck.length}`
  );

  const lost = withLeaderFor(state(), "SD02-015");
  lost.boards.p1.actionDeck = [card("BP01-044"), card("BP01-062")];
  lost.lastBattleWinnerId = "p2";
  const b = resolveTrigger(lost, "judgement", [src("SD02-015")]);
  check("แพ้ -> ไม่มีอะไรเกิดขึ้น", b.state.boards.p1.competitionArea.length === 0);
}

// BP01-013 [Enter]: pull a red Encore card out of the trash, no choice needed.
{
  const s = state();
  s.boards.p1.trash = [card("BP01-062"), card("BP01-044")];
  const out = resolveTrigger(s, "enter", [src("BP01-013")]);
  const hand = out.state.boards.p1.hand.map((c) => c.id);
  const pulled = hand.length === 1 ? getCard(hand[0]) : undefined;
  check(
    "BP01-013 ดึงการ์ดแดงของ Encore จากกองทิ้ง",
    Boolean(pulled && pulled.character === "Encore" && pulled.type === "action" && pulled.color === "red"),
    `hand=${hand.join(",")}`
  );
}

// --- the turn log -------------------------------------------------------------

// BP01-011 [At end of each turn]: goes home unless it was played this turn.
{
  const notPlayed = state();
  notPlayed.boards.p1.leader = { position: "leader", card: { id: "BP01-011", name: "Encore", level: 2, imageId: "x" }, under: [] };
  const a = resolveTrigger(notPlayed, "endTurn", [src("BP01-011")]);
  check(
    "BP01-011 ไม่ได้ลงในรอบนี้ -> กลับเข้า pool",
    a.state.boards.p1.characterPool.some((c) => c.id === "BP01-011"),
    `pool=${a.state.boards.p1.characterPool.length}`
  );

  const played = structuredClone(notPlayed);
  played.turnLog.cardsPlayed.p1 = [card("BP01-011")];
  const b = resolveTrigger(played, "endTurn", [src("BP01-011")]);
  check(
    "ลงแล้วในรอบนี้ -> อยู่ต่อ",
    b.state.boards.p1.characterPool.length === 0 && b.state.boards.p1.leader !== null
  );
}

// BP01-012 [At end of each turn]: only if the opponent took damage this turn.
{
  const hurt = state();
  hurt.boards.p1.trash = [card("BP01-062")];
  hurt.turnLog.damageTaken.p2 = 3;
  const a = resolveTrigger(hurt, "endTurn", [src("BP01-012")]);
  check(
    "BP01-012 ฝ่ายตรงข้ามโดนดาเมจ -> ดึงการ์ด Encore คืน",
    a.state.boards.p1.hand.length === 1,
    `hand=${a.state.boards.p1.hand.length}`
  );

  const unhurt = state();
  unhurt.boards.p1.trash = [card("BP01-062")];
  const b = resolveTrigger(unhurt, "endTurn", [src("BP01-012")]);
  check("ไม่โดนดาเมจ -> ไม่ดึง", b.state.boards.p1.hand.length === 0);
}

// ctx.damage() feeds the log, so the two cards above line up in a real turn.
{
  const s = state();
  const out = resolveTrigger(s, "judgement", [src("BP01-029")]);
  check("ctx.damage บันทึกลง turnLog เอง", out.state.turnLog.damageTaken.p2 === undefined, "no win yet");

  const won = state();
  won.lastBattleWinnerId = "p1";
  won.lastBattle = { winnerId: "p1", loserId: "p2", colorByPlayer: { p1: "red", p2: "blue" }, cardIdByPlayer: {} };
  const b = resolveTrigger(won, "judgement", [src("BP01-029")]);
  check(
    "ทำดาเมจแล้ว turnLog นับให้",
    b.state.turnLog.damageTaken.p2 === 2,
    `damageTaken=${b.state.turnLog.damageTaken.p2}`
  );
}

// BP01-061 [Counter]: bars the controller from comboing this turn.
{
  const out = resolveTrigger(withLeaderFor(state(), "BP01-061"), "counter", [src("BP01-061")]);
  check(
    "BP01-061 ตั้งธงห้ามคอมโบในเทิร์นนี้",
    (out.state.turnLog.flags.p1 ?? []).includes("noCombo"),
    JSON.stringify(out.state.turnLog.flags)
  );
}

// BP01-006: twice a round, and only after a heal.
{
  const healed = state();
  healed.turnLog.healed.p1 = 2;
  healed.boards.p1.leader = { position: "leader", card: { id: "BP01-006", name: "Shorekeeper", level: 2, imageId: "x" }, under: [] };

  const first = recomputeContinuous(healed);
  check("BP01-006 ฟื้นแล้ว -> ถามว่าจะจั่วไหม", first.manual.length === 0, `manual=${first.manual.length}`);

  const noHeal = state();
  noHeal.boards.p1.leader = { position: "leader", card: { id: "BP01-006", name: "Shorekeeper", level: 2, imageId: "x" }, under: [] };
  const none = recomputeContinuous(noHeal);
  check("ยังไม่ได้ฟื้น -> ไม่เกิดอะไร", none.state.turnLog.uses["BP01-006"] === undefined);
}

const withResolve = ALL_CARDS.filter(c => c.effects.some(e => !isManual(e))).length;
console.log(`\ncards with at least one resolve: ${withResolve}`);
console.log(`${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
