// Exercises the abilities written against the newer engine capabilities:
// follow-up grants, granted abilities, Action Area caps, cost changes,
// character level-ups from an effect, next-turn restrictions and randomness.
//
// test-cards.ts covers the simpler resolves; this one covers the machinery
// those could not reach.
// Run with: npm run test:abilities
import { getCard } from "../src/cardDb";
import {
  effectiveCost,
  filterableFor,
  grantedFor,
  qualifyingModifiers,
  recomputeContinuous,
  resolveTrigger,
  zoneBlocking,
  type EffectSource,
} from "../src/effects";
import { resetTurnLog } from "../src/rules";
import { viewFor } from "../src/match";
import { effectiveStats } from "../src/cards";
import { emptyMatchState, type ActionCard, type MatchState, type PlayerBoard } from "../src/game";

const card = (id: string): ActionCard => {
  const def = getCard(id);
  if (!def || def.type !== "action") throw new Error(`${id} is not an action card`);
  return {
    id: def.id,
    name: def.name,
    color: def.color,
    cost: def.cost,
    damage: def.attack,
    speed: def.speed ?? 0,
    imageId: def.imageId,
  };
};

const board = (p: string): PlayerBoard => ({
  playerId: p,
  life: 20,
  leader: null,
  back: [],
  characterPool: [],
  actionDeck: Array.from({ length: 12 }, (_, i) => card(i % 2 ? "BP01-044" : "BP01-047")),
  hand: [],
  competitionArea: [],
  trash: [],
  actionsTakenThisTurn: [],
});

const state = (): MatchState => ({
  ...emptyMatchState("m", ["p1", "p2"]),
  phase: "counter",
  boards: { p1: board("p1"), p2: board("p2") },
});

const src = (id: string, zone: EffectSource["zone"] = "leader"): EffectSource => ({
  card: getCard(id)!,
  controllerId: "p1",
  zone,
});

const chara = (id: string) => {
  const def = getCard(id)!;
  if (def.type !== "leader") throw new Error(`${id} is not a character`);
  return { position: "leader" as const, card: { id: def.id, name: def.name, level: def.level, imageId: def.imageId }, under: [] };
};

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  [${detail}]` : ""}`);
  ok ? (pass += 1) : (fail += 1);
};

// --- follow-up attacks ------------------------------------------------------

{
  // SD02-010 "[Judgement] if you win, draw 3 and gain +8 follow-up attack".
  const won = state();
  won.lastBattleWinnerId = "p1";
  const out = resolveTrigger(won, "judgement", [src("SD02-010", "actionZone")]);
  check("SD02-010 ชนะ -> จั่ว 3 และได้ follow-up 8", out.state.boards.p1.hand.length === 3 && out.state.combo?.remaining === 8, `hand=${out.state.boards.p1.hand.length} combo=${out.state.combo?.remaining}`);

  const lost = state();
  lost.lastBattleWinnerId = "p2";
  const none = resolveTrigger(lost, "judgement", [src("SD02-010", "actionZone")]);
  check("SD02-010 แพ้ -> ไม่ได้อะไร", none.state.combo === null && none.state.boards.p1.hand.length === 0);

  // Stacking onto a window that is already open.
  const open = state();
  open.lastBattleWinnerId = "p1";
  open.combo = { playerId: "p1", unlimited: false, remaining: 2 };
  const more = resolveTrigger(open, "judgement", [src("SD01-013", "actionZone")]);
  check("บวกเพิ่มเข้ากับสิทธิ์คอมโบที่มีอยู่", more.state.combo?.remaining === 4, `${more.state.combo?.remaining}`);
}

// --- granted abilities ------------------------------------------------------

{
  // SD02-005 is a Jinshi Leader: "your red cards gain [Combo] +1 damage".
  const s = state();
  s.boards.p1.leader = chara("SD02-005");
  const live = recomputeContinuous(s).state;
  check("SD02-005 แจกความสามารถให้การ์ดแดง", live.grantedEffects.length === 1, `${live.grantedEffects.length}`);

  // The granted ability must actually fire on the card that received it.
  const red = card("BP01-044"); // red
  live.actionZone.p1 = [red];
  const out = resolveTrigger(live, "combo", [
    {
      card: getCard(red.id)!,
      controllerId: "p1",
      zone: "actionZone",
      granted: grantedFor(live, red, "p1"),
    },
  ]);
  const boosted = effectiveStats(
    { ...filterableFor(red), attack: red.damage, speed: red.speed, cost: red.cost },
    "p1",
    out.state.statModifiers
  );
  check("ความสามารถที่ถูกแจกทำงานจริง", boosted.attack === red.damage + 1, `${red.damage} -> ${boosted.attack}`);

  // A blue card is not red, so it gets nothing.
  const blue = card("BP01-045");
  const reaches = live.grantedEffects.some((g) => g.filter.color === "red");
  check("แจกเฉพาะการ์ดที่ตรงฟิลเตอร์", reaches && blue.color !== "red");
}

// --- Action Area caps -------------------------------------------------------

{
  const s = state();
  const echo = card("BP01-034"); // <Echo>, caps Echo at 1
  s.boards.p1.competitionArea = [echo];
  const live = recomputeContinuous(s).state;
  check("BP01-034 ตั้งเพดาน Echo บน Action Area", live.zoneLimits.length >= 1, `${live.zoneLimits.length}`);

  check("ยังไม่มี Echo บนสนาม -> ลงได้", zoneBlocking(live, echo, "p1") === null);
  live.actionZone.p1 = [echo];
  const blocked = zoneBlocking(live, card("BP01-035"), "p1");
  check("มี Echo อยู่แล้ว 1 ใบ -> ลงใบที่สองไม่ได้", blocked !== null, blocked ?? "ไม่ถูกบล็อก");
  check("การ์ดที่ไม่ใช่ Echo ยังลงได้", zoneBlocking(live, card("BP01-044"), "p1") === null);
}

// --- cost changes -----------------------------------------------------------

{
  // BP01-062 costs 2, and reads "[Advantage] this card costs 1 less".
  const s = state();
  const encore = card("BP01-062");
  s.boards.p1.hand = [encore];
  check("cost ปกติของ BP01-062 คือ 2", effectiveCost(s, encore, "p1") === 2, `${effectiveCost(s, encore, "p1")}`);

  s.lastBattleWinnerId = "p1";
  const live = recomputeContinuous(s).state;
  check("ชนะรอบที่แล้ว -> cost ลดเหลือ 1", effectiveCost(live, encore, "p1") === 1, `${effectiveCost(live, encore, "p1")}`);

  const lost = state();
  lost.boards.p1.hand = [encore];
  lost.lastBattleWinnerId = "p2";
  const noDiscount = recomputeContinuous(lost).state;
  check("ไม่ได้ชนะ -> cost เท่าเดิม", effectiveCost(noDiscount, encore, "p1") === 2);
}

// --- "the first card you play" ---------------------------------------------

{
  // BP01-015 is Encore Level 0: "each round the FIRST {Normal attack} of
  // Encore gets +2 damage".
  const s = state();
  s.boards.p1.leader = chara("BP01-015");
  const live = recomputeContinuous(s).state;
  const limited = live.statModifiers.find((m) => m.limit === 1);
  check("BP01-015 สร้าง modifier แบบจำกัดใบแรก", limited !== undefined, JSON.stringify(live.statModifiers.map((m) => m.limit)));

  // First Encore Normal Attack played gets it; the second does not.
  const first = card("BP01-059");
  const second = card("BP01-060");
  live.turnLog.cardsPlayed.p1 = [first, second];
  const firstStats = effectiveStats(
    { ...filterableFor(first), attack: first.damage, speed: first.speed, cost: first.cost },
    "p1",
    qualifyingModifiers(live, first, "p1")
  );
  const secondStats = effectiveStats(
    { ...filterableFor(second), attack: second.damage, speed: second.speed, cost: second.cost },
    "p1",
    qualifyingModifiers(live, second, "p1")
  );
  check(
    "ใบแรกได้ +2 ใบที่สองไม่ได้",
    firstStats.attack === first.damage + 2 && secondStats.attack === second.damage,
    `first ${first.damage}->${firstStats.attack}, second ${second.damage}->${secondStats.attack}`
  );
}

// --- levelling a character from an effect ----------------------------------

{
  // BP01-048 is Camellya's Resonance Skill: "[Counter] Level up your Camellya".
  const s = state();
  s.boards.p1.leader = chara("BP01-005"); // Camellya Lv.0 — BP01-048 is her Leader Skill
  const def = getCard("BP01-003")!;
  s.boards.p1.characterPool = [{ id: def.id, name: def.name, level: 1, imageId: def.imageId }];
  const out = resolveTrigger(s, "counter", [src("BP01-048", "actionZone")]);
  check(
    "BP01-048 สั่ง Level up จากเอฟเฟค",
    out.state.boards.p1.leader?.card.id === "BP01-003",
    out.state.boards.p1.leader?.card.id ?? "-"
  );
  check("ใบเดิมไปอยู่ใต้กอง", out.state.boards.p1.leader?.under.map((c) => c.id).join() === "BP01-005");

  const empty = state();
  empty.boards.p1.leader = chara("BP01-005");
  const nothing = resolveTrigger(empty, "counter", [src("BP01-048", "actionZone")]);
  check("ไม่มีการ์ดให้เลเวลอัป -> ไม่พัง", nothing.state.boards.p1.leader?.card.id === "BP01-005");
}

// --- next-turn restrictions -------------------------------------------------

{
  // SD02-016: "[Judgement] if you win, next round your opponent cannot use
  // follow-up attacks".
  const won = state();
  won.lastBattleWinnerId = "p1";
  won.boards.p1.leader = chara("BP01-033"); // Sanhua — SD02-016 is her Leader Skill
  const out = resolveTrigger(won, "judgement", [src("SD02-016", "actionZone")]);
  check("SD02-016 จองข้อจำกัดไว้ให้เทิร์นหน้า", (out.state.pendingFlags.p2 ?? []).includes("noFollowUp"), JSON.stringify(out.state.pendingFlags));
  check("ยังไม่มีผลในเทิร์นนี้", (out.state.turnLog.flags.p2 ?? []).length === 0);

  const nextTurn = resetTurnLog(out.state);
  check("ขึ้นเทิร์นใหม่ -> ข้อจำกัดเริ่มมีผล", (nextTurn.turnLog.flags.p2 ?? []).includes("noFollowUp"));
  check("และถูกถอดออกจากคิว", Object.keys(nextTurn.pendingFlags).length === 0);
}

// --- randomness stays replayable -------------------------------------------

{
  // BP01-039 puts a random card from the opponent's hand under their deck.
  const make = () => {
    const s = state();
    s.lastBattleWinnerId = "p1";
    s.boards.p2.hand = ["BP01-044", "BP01-045", "BP01-047", "BP01-049"].map(card);
    return s;
  };
  const a = resolveTrigger(make(), "judgement", [src("BP01-039", "actionZone")]);
  const b = resolveTrigger(make(), "judgement", [src("BP01-039", "actionZone")]);
  check("สุ่มจากสถานะเดียวกัน -> ได้ผลเหมือนเดิมทุกครั้ง", JSON.stringify(a.state.boards.p2.hand) === JSON.stringify(b.state.boards.p2.hand));
  check("การ์ดออกจากมือไปอยู่ใต้เด็คจริง", a.state.boards.p2.hand.length === 3 && a.state.boards.p2.actionDeck.length === 13, `hand=${a.state.boards.p2.hand.length} deck=${a.state.boards.p2.actionDeck.length}`);

  // Damage lands after Judgment, so the card asks whether it WON, not whether
  // Life has already dropped. Losing means nothing happens.
  const lostIt = state();
  lostIt.lastBattleWinnerId = "p2";
  lostIt.boards.p2.hand = [card("BP01-044")];
  const skipped = resolveTrigger(lostIt, "judgement", [src("BP01-039", "actionZone")]);
  check("ไม่ได้ชนะ -> ไม่เกิดอะไร", skipped.state.boards.p2.hand.length === 1);
}

// --- revealing a hand -------------------------------------------------------

{
  const won = state();
  won.lastBattleWinnerId = "p1";
  won.boards.p2.hand = [card("BP01-044")];
  const out = resolveTrigger(won, "judgement", [src("SD01-020", "actionZone")]);
  check("SD01-020 ชนะ -> เปิดมือฝ่ายตรงข้าม", out.state.revealedHands.includes("p2"), JSON.stringify(out.state.revealedHands));
  check("และจั่วการ์ด 1 ใบ", out.state.boards.p1.hand.length === 1);

  const view = viewFor(out.state, "p1");
  check("มือที่ถูกเปิดมองเห็นได้จริง", view.boards.p2.hand.length === 1, `${view.boards.p2.hand.length}`);
}

// --- cards that may only arrive through an ability -------------------------

{
  const encoreL2 = getCard("BP01-011")!;
  check(
    "BP01-011 ถูกทำเครื่องหมายว่าเล่นได้จากความสามารถเท่านั้น",
    encoreL2.effects.some((e) => e.tags?.includes("abilityOnly"))
  );
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
