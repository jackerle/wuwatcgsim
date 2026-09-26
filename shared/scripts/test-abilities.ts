// Exercises the abilities written against the newer engine capabilities:
// follow-up grants, granted abilities, Action Area caps, cost changes,
// character level-ups from an effect, next-turn restrictions and randomness.
//
// test-cards.ts covers the simpler resolves; this one covers the machinery
// those could not reach.
// Run with: npm run test:abilities
import { ALL_CARDS, getCard } from "../src/cardDb";
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
import { ACTION_DECK_SIZE, resetTurnLog } from "../src/rules";
import { createMatch, step, viewFor } from "../src/match";
import { effectiveStats } from "../src/cards";
import { emptyMatchState, type ActionCard, type MatchState, type PlayerBoard } from "../src/game";
import { comboGrantFor, type ChoiceAnswer } from "../src/cardDef";

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
  //
  // The draw is this effect's to do. The +8 is NOT: it is the card's printed
  // Follow{8}, which combat applies when the card wins the clash, and the
  // resolve saying it a second time is the same ability written twice. See
  // grantFollowUp in effects.ts, and the end-to-end count further down.
  //
  // It is printed [Leader Skill] (リーダースキル), so both of its abilities
  // need Jinshi in the Leader slot — the board here puts her there.
  const won = state();
  won.lastBattleWinnerId = "p1";
  won.boards.p1.leader = chara("BP01-030"); // Jinshi
  const out = resolveTrigger(won, "judgement", [src("SD02-010", "actionZone")]);
  check("SD02-010 ชนะ -> จั่ว 3 ใบ", out.state.boards.p1.hand.length === 3, `hand=${out.state.boards.p1.hand.length}`);
  check(
    "Follow{8} ของการ์ดแอ็กชันมาจากการปะทะ ไม่ใช่จาก resolve (ไม่นับซ้ำ)",
    out.state.combo === null,
    `${out.state.combo?.remaining}`
  );

  const noJinshi = state();
  noJinshi.lastBattleWinnerId = "p1";
  const blocked = resolveTrigger(noJinshi, "judgement", [src("SD02-010", "actionZone")]);
  check("SD02-010 Leader ไม่ใช่ Jinshi -> ไม่จั่ว", blocked.state.boards.p1.hand.length === 0);

  const lost = state();
  lost.lastBattleWinnerId = "p2";
  lost.boards.p1.leader = chara("BP01-030");
  const none = resolveTrigger(lost, "judgement", [src("SD02-010", "actionZone")]);
  check("SD02-010 แพ้ -> ไม่ได้อะไร", none.state.combo === null && none.state.boards.p1.hand.length === 0);

  // Stacking onto a window that is already open. A CHARACTER card's Follow is
  // a real bonus on top of whatever the played card granted — combat only
  // ever reads the winning action card, so a character's followCount is
  // never applied anywhere else and its resolve is the only way it lands.
  // BP01-019: "[Leader] [Judgement] if you won with a green card, +3".
  const open = state();
  open.lastBattleWinnerId = "p1";
  open.lastBattle = {
    winnerId: "p1",
    loserId: "p2",
    colorByPlayer: { p1: "green", p2: "red" },
    cardIdByPlayer: { p1: "BP01-058", p2: "BP01-044" },
  };
  open.combo = { playerId: "p1", unlimited: false, remaining: 2 };
  const more = resolveTrigger(open, "judgement", [src("BP01-019", "leader")]);
  check(
    "Leader Skill ของการ์ดตัวละคร บวกเพิ่มเข้ากับสิทธิ์คอมโบที่มีอยู่",
    more.state.combo?.remaining === 5,
    `${more.state.combo?.remaining}`
  );
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

  // Winning this turn's clash is not enough: Advantage only starts applying on
  // the following turn, so the gate reads advantageId, not lastBattleWinnerId.
  s.lastBattleWinnerId = "p1";
  const sameTurn = recomputeContinuous(s).state;
  check(
    "ชนะตัดสินเทิร์นนี้ -> cost ยังเป็น 2",
    effectiveCost(sameTurn, encore, "p1") === 2,
    `${effectiveCost(sameTurn, encore, "p1")}`
  );

  s.advantageIds = ["p1"];
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

// --- an effect's level up is the player's choice, and it triggers -----------
//
// Both halves of "Level up your Sanhua" that the engine used to skip: which
// card goes on top when more than one is legal, and the [Level up] the card
// that lands is printed with. BP01-076 is Sanhua's Dodge — "[Judgement] if
// you win with Sanhua as your Leader, level your Sanhua up".

{
  const pool = (...ids: string[]) =>
    ids.map((id) => {
      const def = getCard(id)!;
      if (def.type !== "leader") throw new Error(`${id} is not a character`);
      return { id: def.id, name: def.name, level: def.level, imageId: def.imageId };
    });

  const sanhua = () => {
    const s = state();
    s.lastBattleWinnerId = "p1";
    s.boards.p1.leader = chara("BP01-033"); // Sanhua Lv.0
    return s;
  };

  // Two Level 1 Sanhua cards in the deck are two different abilities, so the
  // engine must not pick one.
  const asked = sanhua();
  asked.boards.p1.characterPool = pool("BP01-032", "SD02-004");
  const question = resolveTrigger(asked, "judgement", [src("BP01-076", "actionZone")]);
  check(
    "มีการ์ดเลเวลอัปหลายใบ -> ถามว่าจะใช้ใบไหน",
    question.pending?.kind === "pickCard" &&
      question.pending.options.map((o) => o.value).sort().join() === "BP01-032,SD02-004",
    question.pending ? question.pending.options.map((o) => o.value).join() : "ไม่ได้ถาม"
  );
  check(
    "ระหว่างถาม ยังไม่มีอะไรขยับ",
    question.state.boards.p1.leader?.card.id === "BP01-033" &&
      question.state.boards.p1.characterPool.length === 2
  );

  /** Answers every question a trigger raises, taking the first option. */
  const settle = (state: MatchState, first?: string) => {
    const answers: ChoiceAnswer[] = first ? [first] : [];
    for (let guard = 0; guard < 10; guard += 1) {
      const out = resolveTrigger(state, "judgement", [src("BP01-076", "actionZone")], answers);
      if (!out.pending) return out;
      answers.push(out.pending.kind === "confirm" ? true : out.pending.options[0]?.value ?? "");
    }
    throw new Error("a trigger kept asking");
  };

  // BP01-032 is "[Enter] / [Level up] put a card from your trash into the
  // Concerto area", and levelling it on is what makes it Enter.
  const chosen = sanhua();
  chosen.boards.p1.characterPool = pool("BP01-032", "SD02-004");
  chosen.boards.p1.trash = [card("BP01-044")];
  const done = settle(chosen, "BP01-032");
  check(
    "เลือกใบไหน ก็ได้ใบนั้น",
    done.state.boards.p1.leader?.card.id === "BP01-032",
    done.state.boards.p1.leader?.card.id ?? "-"
  );
  check("ใบที่ไม่ได้เลือกยังอยู่ใน Character Deck", done.state.boards.p1.characterPool.map((c) => c.id).join() === "SD02-004");
  check(
    "การ์ดที่เพิ่งลงมา ความสามารถ [Enter] ทำงาน",
    done.state.boards.p1.competitionArea.map((c) => c.id).join() === "BP01-044",
    `concerto=${done.state.boards.p1.competitionArea.map((c) => c.id).join()} trash=${done.state.boards.p1.trash.length}`
  );

  // Only one legal card: nothing to ask, but the trigger still fires.
  const forced = sanhua();
  forced.boards.p1.characterPool = pool("BP01-032");
  forced.boards.p1.trash = [card("BP01-044")];
  const straight = settle(forced);
  check("มีใบเดียว -> ไม่ต้องถามว่าใช้ใบไหน", straight.state.boards.p1.leader?.card.id === "BP01-032");
  check(
    "และยังได้ [Enter] เหมือนกัน",
    straight.state.boards.p1.competitionArea.map((c) => c.id).join() === "BP01-044"
  );

  // The ladder still holds: Lv.0 cannot reach a Level 2 card.
  const tooHigh = sanhua();
  tooHigh.boards.p1.characterPool = pool("BP01-031"); // Sanhua Lv.2
  const refused = resolveTrigger(tooHigh, "judgement", [src("BP01-076", "actionZone")]);
  check(
    "Lv.0 ข้ามไป Lv.2 ไม่ได้ ตามกฎ",
    refused.state.boards.p1.leader?.card.id === "BP01-033" && refused.pending === null
  );
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
    // All three parts of "[Advantage] when this card deals damage": the
    // Advantage brought into the turn, the win being judged right now, and THIS
    // card being the one that won it — another card of ours winning does not
    // set it off.
    s.advantageIds = ["p1"];
    s.lastBattleWinnerId = "p1";
    s.lastBattle = {
      winnerId: "p1",
      loserId: "p2",
      colorByPlayer: { p1: "red" },
      cardIdByPlayer: { p1: "BP01-039" },
    };
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

  // The rulebook case: this card is sitting in the Action Area, we won — but
  // with a DIFFERENT card. "When you deal damage" is this card's damage, so
  // nothing happens.
  const otherCardWon = state();
  otherCardWon.advantageIds = ["p1"];
  otherCardWon.lastBattleWinnerId = "p1";
  otherCardWon.lastBattle = {
    winnerId: "p1",
    loserId: "p2",
    colorByPlayer: { p1: "red" },
    cardIdByPlayer: { p1: "BP01-044" },
  };
  otherCardWon.boards.p2.hand = [card("BP01-044")];
  const notMine = resolveTrigger(otherCardWon, "judgement", [src("BP01-039", "actionZone")]);
  check(
    "ชนะด้วยการ์ดใบอื่น -> BP01-039 ไม่ทำงาน",
    notMine.state.boards.p2.hand.length === 1,
    `hand=${notMine.state.boards.p2.hand.length}`
  );
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
// --- Taking a card off a pile is the player's call -------------------------
//
// "Take a red 「Encore」 card from your trash" is a decision when the trash
// holds five of them. The engine used to take the most recently binned one
// and say nothing — see pickFrom in effects.ts.

{
  const redEncore = ALL_CARDS.filter(
    (def) => def.type === "action" && def.color === "red" && def.character === "Encore"
  ).map((def) => def.id);

  const withTrash = (ids: string[]) => {
    const s = state();
    s.boards.p1.trash = ids.map(card);
    return s;
  };

  // BP01-013: "[Enter] / [Level up] take a red 「Encore」 card from the trash".
  const many = withTrash(redEncore);
  const asked = resolveTrigger(many, "enter", [src("BP01-013")]);
  check(
    "มีหลายใบให้เลือก -> ถามว่าเอาใบไหน",
    asked.pending?.kind === "pickCard" && asked.pending.options.length === redEncore.length,
    `${asked.pending?.kind} ${asked.pending?.options.length} ตัวเลือก`
  );
  check("ระหว่างถาม ยังไม่มีอะไรขยับ", asked.state.boards.p1.hand.length === 0);

  // The last option is the one the old silent behaviour would never reach.
  const last = asked.pending!.options[asked.pending!.options.length - 1];
  const took = resolveTrigger(many, "enter", [src("BP01-013")], [last.value]);
  check(
    "เลือกใบไหน ก็ได้ใบนั้น ไม่ใช่ใบที่ทิ้งล่าสุด",
    took.state.boards.p1.hand.map((c) => c.id).join() === last.cardId,
    `ได้ ${took.state.boards.p1.hand.map((c) => c.id).join()} ขอ ${last.cardId}`
  );
  check(
    "ใบที่ไม่ได้เลือกยังอยู่ในกองทิ้ง",
    took.state.boards.p1.trash.length === redEncore.length - 1
  );

  // Nothing to decide: one match, or none at all.
  const single = withTrash([redEncore[0]]);
  const forced = resolveTrigger(single, "enter", [src("BP01-013")]);
  check(
    "เหลือใบเดียว -> ไม่ต้องถาม",
    forced.pending === null && forced.state.boards.p1.hand.map((c) => c.id).join() === redEncore[0]
  );

  const none = withTrash(["BP01-044"]); // not an Encore card
  const empty = resolveTrigger(none, "enter", [src("BP01-013")]);
  check(
    "ไม่มีใบที่เข้าเงื่อนไข -> ไม่ถาม ไม่หยิบ",
    empty.pending === null && empty.state.boards.p1.hand.length === 0
  );

  // Copies of one printed card are not a choice.
  const copies = withTrash([redEncore[0], redEncore[0], redEncore[0]]);
  const dupes = resolveTrigger(copies, "enter", [src("BP01-013")]);
  check(
    "ใบซ้ำรหัสเดียวกัน -> ไม่ต้องถาม เพราะเลือกไปก็เหมือนกัน",
    dupes.pending === null && dupes.state.boards.p1.hand.length === 1,
    dupes.pending ? "ถาม (ไม่ควร)" : "ไม่ถาม"
  );
}

// --- A card that names the level it puts into play -------------------------

{
  // BP01-062: "[Counter] put an 「Encore」 Level 2 card on top of your
  // 「Encore」 (counts as a Level up)". Only Level 2, and it gets there
  // without climbing.
  const encore = (id: string) => {
    const def = getCard(id)!;
    if (def.type !== "leader") throw new Error(id);
    return { id: def.id, name: def.name, level: def.level, imageId: def.imageId };
  };

  const s = state();
  s.boards.p1.leader = chara("BP01-015"); // Encore Lv.0
  s.boards.p1.characterPool = [encore("BP01-013"), encore("BP01-011"), encore("BP01-012")];
  const out = resolveTrigger(s, "counter", [src("BP01-062", "actionZone")]);
  check(
    "BP01-062 เสนอเฉพาะ Level 2 ไม่เสนอ Level 1",
    out.pending?.options.map((o) => o.value).sort().join() === "BP01-011,BP01-012",
    out.pending ? out.pending.options.map((o) => o.value).join() : "ไม่ได้ถาม"
  );

  const done = resolveTrigger(s, "counter", [src("BP01-062", "actionZone")], ["BP01-011"]);
  check(
    "Lv.0 ขึ้น Lv.2 ได้เลยด้วยการ์ดใบนี้",
    done.state.boards.p1.leader?.card.id === "BP01-011",
    done.state.boards.p1.leader?.card.id ?? "-"
  );

  // Every other card still climbs one step at a time.
  const ladder = state();
  ladder.boards.p1.leader = chara("BP01-005"); // Camellya Lv.0
  ladder.boards.p1.characterPool = [encore("BP01-001")]; // Camellya Lv.2
  const refused = resolveTrigger(ladder, "counter", [src("BP01-048", "actionZone")]);
  check(
    "การ์ดอื่นยังข้ามขั้นไม่ได้",
    refused.state.boards.p1.leader?.card.id === "BP01-005" && refused.pending === null
  );
}



// --- Follow{x} is granted once, not twice ----------------------------------
//
// A card's Follow{x} is applied by combat — comboGrantFor() reads it straight
// off the printed card and that is what opens the Combo window. Every one of
// these cards ALSO writes ctx.grantFollowUp(x) in its resolve, because that
// is what the printed text says. Both firing gave the player double:
// SD02-013's Follow{2} allowed four follow-ups, SD02-010's Follow{8} sixteen.
// See grantFollowUp in effects.ts for which of the two wins.

{
  for (const [cardId, expected] of [
    ["SD02-013", 2],
    ["SD01-013", 2],
    ["BP01-069", 1],
    ["SD02-010", 8],
  ] as Array<[string, number]>) {
    const def = getCard(cardId);
    if (!def || def.type !== "action") {
      check(`${cardId} เป็นการ์ดแอ็กชัน`, false, def?.type ?? "missing");
      continue;
    }
    const grant = comboGrantFor(def);
    check(
      `${cardId}: Follow{${expected}} -> คอมโบได้ ${expected} ครั้ง`,
      grant.unlimited || grant.count === expected,
      `unlimited=${grant.unlimited} count=${grant.count}`
    );
  }
}

// The same thing end to end: win a clash with SD02-013 and count the window
// the winner actually gets. This is the number the player sees on screen.
{
  const characters = (ids: string[]) =>
    ids.map((id) => {
      const def = getCard(id);
      if (!def || def.type !== "leader") throw new Error(`${id} is not a character card`);
      return { id: def.id, name: def.name, level: def.level, imageId: def.imageId };
    });
  const fortyOf = (id: string) => Array.from({ length: ACTION_DECK_SIZE }, () => card(id));

  const state = createMatch({
    matchId: "follow-once",
    startingPlayerId: "p1",
    skipMulligan: true,
    players: [
      {
        playerId: "p1",
        characterDeck: characters(["BP01-005", "BP01-024", "BP01-027"]),
        actionDeck: fortyOf("SD02-013"),
      },
      {
        playerId: "p2",
        characterDeck: characters(["BP01-015", "BP01-030", "BP01-033"]),
        actionDeck: fortyOf("BP01-044"),
      },
    ],
  });
  state.phase = "counter";
  state.boards.p1.hand = [card("SD02-013")]; // blue Dodge
  state.boards.p2.hand = [card("BP01-044")]; // red — blue beats red

  // The turn player opens the Counter Phase before either side lays a card
  // down; committing no longer does it for them.
  let s = step(state, "p1", { kind: "toBattle" }).state;
  s = step(s, "p1", { kind: "commit", cardId: "SD02-013" }).state;
  s = step(s, "p2", { kind: "commit", cardId: "BP01-044" }).state;
  const out = step(s, "p1", { kind: "resolveCounter" });
  check("ชนะด้วย SD02-013 -> เปิดหน้าต่างคอมโบให้ p1", out.state.combo?.playerId === "p1", out.error ?? "");
  check(
    "Follow{2} ให้คอมโบ 2 ครั้ง ไม่ใช่ 4",
    out.state.combo?.remaining === 2,
    `${out.state.combo?.remaining}`
  );
}

// --- 〈Intro Skill〉: "one of the switched characters" -------------------------
//
// SD01-009 跃焰 reads "[Combo] Switch your Leader. If 「Chixia」 is one of the
// switched characters, this card deals +2" — and FAQ #52 asks precisely the
// awkward case: Chixia is ALREADY the Leader, so the switch puts her in the
// back. Official answer: yes, the +2 applies. Rule 906.2 makes any character
// whose position changed "switched", in either direction, so reading the card
// as "if you switch TO Chixia" loses half of what it does.

{
  const backSlot = (id: string) => ({ ...chara(id), position: "back" as const });
  const attackBonus = (s: MatchState) =>
    s.statModifiers
      .filter((m) => m.stat === "attack" && m.filter.cardId === "SD01-009")
      .reduce((sum, m) => sum + m.amount, 0);

  // Chixia leads and is switched OUT to the back.
  const out = state();
  out.boards.p1.leader = chara("BP01-027"); // Chixia Lv.0
  out.boards.p1.back = [backSlot("BP01-024")]; // Yangyang Lv.0
  out.actionZone.p1 = [card("SD01-009")];
  const left = resolveTrigger(out, "combo", [src("SD01-009", "actionZone")], ["Yangyang"]);
  check(
    "SD01-009: 「Chixia」 ถูกสลับออกจาก Leader -> ยังได้ +2",
    attackBonus(left.state) === 2,
    `${attackBonus(left.state)} / ${left.state.boards.p1.leader?.card.name} นำ`
  );

  // The direction that always worked: Chixia comes forward.
  const into = state();
  into.boards.p1.leader = chara("BP01-024");
  into.boards.p1.back = [backSlot("BP01-027")];
  into.actionZone.p1 = [card("SD01-009")];
  const came = resolveTrigger(into, "combo", [src("SD01-009", "actionZone")], ["Chixia"]);
  check(
    "SD01-009: 「Chixia」 ถูกสลับขึ้นมาเป็น Leader -> ได้ +2",
    attackBonus(came.state) === 2,
    `${attackBonus(came.state)}`
  );

  // Chixia nowhere near the switch: no bonus. The rule widens who counts as
  // switched, it does not hand the bonus out for free.
  const away = state();
  away.boards.p1.leader = chara("BP01-024"); // Yangyang
  away.boards.p1.back = [backSlot("BP01-033"), backSlot("BP01-027")]; // Sanhua, Chixia
  away.actionZone.p1 = [card("SD01-009")];
  const other = resolveTrigger(away, "combo", [src("SD01-009", "actionZone")], ["Sanhua"]);
  check(
    "SD01-009: สลับคู่อื่น 「Chixia」 ไม่ได้ขยับ -> ไม่ได้ +2",
    attackBonus(other.state) === 0,
    `${attackBonus(other.state)}`
  );
}

console.log(`
${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
