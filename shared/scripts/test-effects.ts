// End-to-end check of the merged card definition + effect system.
// Run with: npm run test:effects
import {
  resolveCombat,
  type ActionCard,
  type CharacterCard,
  type MatchState,
  type PlayerBoard,
} from "../src/game";
import { emptyMatchState } from "../src/game";
import {
  CARD_KEYWORDS,
  CONDITION_KEYWORDS,
  CONTINUOUS_KEYWORDS,
  KEYWORD_COLOR,
  KEYWORD_LABEL,
  MODIFIER_KEYWORDS,
  TRIGGER_KEYWORDS,
  effectiveStats,
  keywordForTag,
  localize,
} from "../src/cards";
import {
  comboGrantFor,
  defineCard,
  effectSegments,
  followCountOf,
  formatEffect,
  isManual,
  triggerOf,
  type CardDef,
  type CardEffect,
} from "../src/cardDef";
import { validateCard } from "../src/cardDb";
import {
  comboLookupFromDb,
  damageTakenModifier,
  expireModifiers,
  recomputeContinuous,
  resolveTrigger,
  type EffectSource,
} from "../src/effects";

function card(id: string, color: ActionCard["color"] = "red"): ActionCard {
  return { id, name: id, color, cost: 0, damage: 1, speed: 1, imageId: id };
}

function chara(id: string): CharacterCard {
  return { id, name: id, level: 0, imageId: id };
}

function board(playerId: string): PlayerBoard {
  return {
    playerId,
    life: 20,
    leader: null,
    back: [],
    characterPool: [],
    actionDeck: Array.from({ length: 10 }, (_, i) => card(`${playerId}-deck-${i}`)),
    hand: Array.from({ length: 5 }, (_, i) => card(`${playerId}-hand-${i}`, "blue")),
    competitionArea: [],
    trash: [],
    actionsTakenThisTurn: [],
  };
}

function freshState(): MatchState {
  return {
    ...emptyMatchState("m1", ["p1", "p2"]),
    phase: "action",
    boards: { p1: board("p1"), p2: board("p2") },
  }
}

function action(id: string, effects: CardEffect[]): CardDef {
  return defineCard({
    type: "action",
    id,
    name: id,
    character: null,
    set: "BP01",
    imageId: id,
    cost: 0,
    color: "red",
    speed: 1,
    attack: 1,
    effects,
  });
}

function source(cardDef: CardDef, controllerId = "p1"): EffectSource {
  return { card: cardDef, controllerId, zone: "leader" };
}

const results: { name: string; pass: boolean; detail: string }[] = [];
function check(name: string, pass: boolean, detail = "") {
  results.push({ name, pass, detail });
}

// 1. an effect with a resolve runs automatically ------------------------------
{
  const def = action("T-001", [
    {
      condition: ["enter"],
      text: { th: "จั่ว 2 ใบ แล้วดาเมจ 3" },
      resolve: (ctx) => {
        ctx.draw(2);
        ctx.damage(3);
      },
    },
  ]);
  const out = resolveTrigger(freshState(), "enter", [source(def)]);
  check(
    "effect ที่มี resolve รันเอง",
    out.resolved[0].status === "applied" &&
      out.state.boards.p1.hand.length === 7 &&
      out.state.boards.p2.life === 17,
    `status=${out.resolved[0].status} hand=${out.state.boards.p1.hand.length} p2life=${out.state.boards.p2.life}`
  );
}

// 2. no resolve -> handed to the players, state untouched ---------------------
{
  const def = action("T-002", [
    { condition: ["enter"], text: { th: "ทำอะไรแปลกๆ ที่ยังไม่ได้เขียนโค้ด" } },
  ]);
  const out = resolveTrigger(freshState(), "enter", [source(def)]);
  check(
    "ไม่มี resolve -> ส่งข้อความให้คนทำเอง ไม่แตะ state",
    out.manual.length === 1 &&
      localize(out.manual[0].effect.text) === "ทำอะไรแปลกๆ ที่ยังไม่ได้เขียนโค้ด" &&
      out.state.boards.p1.hand.length === 5,
    `manual=${out.manual.length}`
  );
}

// 3. trigger isolation ---------------------------------------------------------
{
  const def = action("T-003", [
    { condition: ["enter"], text: { th: "ดาเมจ 9" }, resolve: (ctx) => ctx.damage(9) },
  ]);
  const out = resolveTrigger(freshState(), "endTurn", [source(def)]);
  check(
    "trigger ที่การ์ดไม่เกี่ยว ไม่มีอะไรเกิดขึ้น",
    out.resolved.length === 0 && out.state.boards.p2.life === 20,
    `resolved=${out.resolved.length}`
  );
}

// 4. advantage as a condition keyword ------------------------------------------
{
  const def = action("T-004", [
    {
      condition: ["judgement", "advantage"],
      text: { th: "ดาเมจ 5 ถ้าชนะรอบที่แล้ว" },
      resolve: (ctx) => ctx.damage(5),
    },
  ]);
  const lost = freshState();
  lost.advantageIds = ["p2"];
  const won = freshState();
  won.advantageIds = ["p1"];
  // Winning THIS turn's clash is not Advantage yet: lastBattleWinnerId is
  // already p1 by the time [Judgement] runs, and the gate must not read it.
  const justWon = freshState();
  justWon.lastBattleWinnerId = "p1";
  justWon.advantageIds = [];

  const blocked = resolveTrigger(lost, "judgement", [source(def)]);
  const allowed = resolveTrigger(won, "judgement", [source(def)]);
  const sameTurn = resolveTrigger(justWon, "judgement", [source(def)]);

  check(
    "advantage: ไม่ได้ชนะรอบที่แล้ว -> skipped",
    blocked.resolved[0].status === "skipped" && blocked.state.boards.p2.life === 20,
    blocked.resolved[0].reason ?? ""
  );
  check(
    "advantage: ชนะรอบที่แล้ว -> ทำงาน",
    allowed.resolved[0].status === "applied" && allowed.state.boards.p2.life === 15,
    `p2life=${allowed.state.boards.p2.life}`
  );
  check(
    "advantage: ชนะตัดสินเทิร์นนี้ -> ยังไม่ได้ advantage",
    sameTurn.resolved[0].status === "skipped" && sameTurn.state.boards.p2.life === 20,
    sameTurn.resolved[0].reason ?? ""
  );
}

// 5. a custom condition function ----------------------------------------------
{
  const def = action("T-005", [
    {
      condition: ["enter", (ctx) => ctx.hand().length >= 5],
      text: { th: "ถ้ามีการ์ดในมือ 5 ใบขึ้นไป จั่ว 2" },
      resolve: (ctx) => ctx.draw(2),
    },
  ]);

  const enough = resolveTrigger(freshState(), "enter", [source(def)]);

  const notEnough = freshState();
  notEnough.boards.p1.hand = notEnough.boards.p1.hand.slice(0, 2);
  const blocked = resolveTrigger(notEnough, "enter", [source(def)]);

  check(
    "เงื่อนไขแบบฟังก์ชัน: ผ่าน -> รัน",
    enough.resolved[0].status === "applied" && enough.state.boards.p1.hand.length === 7,
    `hand=${enough.state.boards.p1.hand.length}`
  );
  check(
    "เงื่อนไขแบบฟังก์ชัน: ไม่ผ่าน -> skipped ไม่แตะ state",
    blocked.resolved[0].status === "skipped" && blocked.state.boards.p1.hand.length === 2,
    `hand=${blocked.state.boards.p1.hand.length}`
  );
}

// 6. a resolve that throws is rolled back completely ---------------------------
{
  const def = action("T-006", [
    {
      condition: ["battle"],
      text: { th: "จั่ว 2 แล้วพัง" },
      resolve: (ctx) => {
        ctx.draw(2);
        throw new Error("boom");
      },
    },
  ]);
  const out = resolveTrigger(freshState(), "battle", [source(def)]);
  check(
    "resolve พังกลางทาง -> ย้อน state คืนทั้งหมด",
    out.resolved[0].status === "failed" && out.state.boards.p1.hand.length === 5,
    `status=${out.resolved[0].status} hand=${out.state.boards.p1.hand.length}`
  );
}

// 7. the real Camellya card, written the way a set file would ------------------
{
  const camellya = defineCard({
    type: "leader",
    id: "BP01-001",
    name: "Camellya",
    character: "Camellya",
    set: "BP01",
    imageId: "BP01-001",
    level: 2,
    rarity: 3,
    element: "havoc",
    weapon: "sword",
    effects: [
      {
        condition: ["levelUp"],
        text: { th: "นำการ์ดใบนี้กลับเข้า Character deck" },
        resolve: (ctx) => ctx.returnToCharacterDeck(),
      },
      {
        condition: ["leader"],
        text: { th: "ดาเมจที่เจ้าของได้รับ +1 การ์ดสีแดงของ「Camellya」ได้รับ +1 ดาเมจ" },
        resolve: (ctx) => {
          ctx.modifyDamageTaken(+1);
          ctx.buff({ character: "Camellya", color: "red" }, "attack", +1);
        },
      },
    ],
  });

  check("การ์ดจริงผ่าน validate", validateCard(camellya).length === 0, JSON.stringify(validateCard(camellya)));

  // Level up: the card goes back to the character pool.
  const onField = freshState();
  onField.boards.p1.leader = { position: "leader", card: chara("BP01-001"), under: [] };
  const levelled = resolveTrigger(onField, "levelUp", [source(camellya)]);
  check(
    "Level up -> การ์ดกลับเข้า Character deck และออกจากสนาม",
    levelled.state.boards.p1.characterPool.some((c) => c.id === "BP01-001") &&
      levelled.state.boards.p1.leader === null,
    `pool=${levelled.state.boards.p1.characterPool.length} leader=${levelled.state.boards.p1.leader}`
  );

  // Leader passive: both clauses of the printed line.
  const withLeader = freshState();
  withLeader.boards.p1.leader = { position: "leader", card: chara("BP01-001"), under: [] };
  const continuous = recomputeContinuous(withLeader, () => camellya);
  const mods = continuous.state.statModifiers;

  const camellyaRed = effectiveStats(
    { id: "x", color: "red", character: "Camellya", attack: 5, speed: 0 },
    "p1",
    mods
  );
  const otherRed = effectiveStats(
    { id: "y", color: "red", character: "Jiyan", attack: 5, speed: 0 },
    "p1",
    mods
  );

  check(
    "Leader passive: การ์ดแดงของ Camellya +1 / ของตัวอื่นไม่โดน",
    camellyaRed.attack === 6 && otherRed.attack === 5,
    `camellya=${camellyaRed.attack} other=${otherRed.attack}`
  );
  check(
    "Leader passive: เจ้าของรับดาเมจ +1",
    damageTakenModifier(continuous.state, "p1") === 1 &&
      damageTakenModifier(continuous.state, "p2") === 0,
    `p1=${damageTakenModifier(continuous.state, "p1")} p2=${damageTakenModifier(continuous.state, "p2")}`
  );
}

// 8. passive is idempotent -----------------------------------------------------
{
  const def = action("T-008", [
    {
      condition: ["passive"],
      text: { th: "แดง +2 ตลอดเวลา" },
      resolve: (ctx) => ctx.buff({ color: "red" }, "attack", +2),
    },
  ]);
  const start = freshState();
  start.boards.p1.leader = { position: "leader", card: chara("T-008"), under: [] };

  // Only the Leader resolves to this card. A resolver that answered for every
  // id would also hand the passive to every card in hand and in the Action
  // Area, which is not what is being measured here.
  const only = (id: string) => (id === "T-008" ? def : undefined);
  let s = recomputeContinuous(start, only).state;
  const afterOne = s.statModifiers.length;
  for (let i = 0; i < 5; i += 1) s = recomputeContinuous(s, only).state;

  const stats = effectiveStats({ id: "r", color: "red", attack: 5, speed: 0 }, "p1", s.statModifiers);
  check(
    "passive รัน recompute 6 รอบ ไม่บวกซ้อน",
    afterOne === 1 && s.statModifiers.length === 1 && stats.attack === 7,
    `mods=${s.statModifiers.length} attack=${stats.attack}`
  );
}

// 9. leader passive only applies to the ACTIVE leader ---------------------------
{
  const def = defineCard({
    type: "leader",
    id: "T-009",
    name: "T-009",
    character: "T-009",
    set: "BP01",
    imageId: "T-009",
    level: 1,
    effects: [
      {
        condition: ["leader"],
        text: { th: "น้ำเงิน speed +1" },
        resolve: (ctx) => ctx.buff({ color: "blue" }, "speed", +1),
      },
    ],
  });
  const asLeader = freshState();
  asLeader.boards.p1.leader = { position: "leader", card: chara("T-009"), under: [] };
  const inBack = freshState();
  inBack.boards.p1.leader = null;
  inBack.boards.p1.back = [{ position: "back", card: chara("T-009"), under: [] }];

  check("อยู่ leader -> ทำงาน", recomputeContinuous(asLeader, () => def).state.statModifiers.length === 1);
  check("อยู่ back -> leader passive ไม่ทำงาน", recomputeContinuous(inBack, () => def).state.statModifiers.length === 0);
}

// 10. combo rules ---------------------------------------------------------------
{
  const red = action("T-010R", []);
  const greenNoFollow = { ...action("T-010G", []), color: "green" as const, chase: 2 };
  const greenFollow = {
    ...action("T-010F", [{ condition: ["follow"], followCount: 2, text: { th: "Follow{2}" } }]),
    color: "green" as const,
  };

  check("followCountOf อ่าน Follow{2} ได้", followCountOf(greenFollow) === 2);
  check("ไม่มี Follow -> null", followCountOf(greenNoFollow) === null);
  check("แดงชนะ -> คอมโบไม่จำกัด", comboGrantFor(red).unlimited === true);
  check("เขียวไม่มี Follow -> ต่อคอมโบไม่ได้", comboGrantFor(greenNoFollow).count === 0);
  check("เขียวมี Follow{2} -> ต่อได้ 2", comboGrantFor(greenFollow).count === 2);

  const db: Record<string, CardDef> = { "G-NF": { ...greenNoFollow, id: "G-NF" } };
  const greenCard = (id: string): ActionCard => ({
    id, name: id, color: "green", cost: 0, damage: 4, speed: 9, imageId: id,
  });
  const blueCard = (id: string): ActionCard => ({
    id, name: id, color: "blue", cost: 0, damage: 4, speed: 1, imageId: id,
  });
  const realRule = resolveCombat(
    { playerId: "p1", card: greenCard("G-NF") },
    { playerId: "p2", card: blueCard("B") },
    [],
    comboLookupFromDb((id) => db[id])
  );
  check(
    "resolveCombat + lookup -> ใช้กฎ Follow จริง",
    realRule.winnerId === "p1" && realRule.combo?.count === 0,
    `winner=${realRule.winnerId} count=${realRule.combo?.count}`
  );
}

// 11. durations expire at the right moment --------------------------------------
{
  const state = freshState();
  state.statModifiers = (["battle", "turn", "permanent"] as const).map((duration, i) => ({
    id: `m${i}`, controllerId: "p1", sourceCardId: "T-011",
    stat: "attack" as const, amount: 1, filter: {}, duration,
  }));
  check(
    "จบ battle เหลือ turn กับ permanent",
    expireModifiers(state, "battle").statModifiers.map((m) => m.duration).join(",") === "turn,permanent"
  );
  check(
    "จบเทิร์น เหลือแค่ permanent",
    expireModifiers(state, "turn").statModifiers.map((m) => m.duration).join(",") === "permanent"
  );
}

// 12. validation catches what types cannot --------------------------------------
{
  const blueWithSpeed = { ...action("V-001", []), color: "blue" as const, speed: 7 };
  const greenNoSpeed = { ...action("V-001b", []), color: "green" as const, speed: null };
  const followNoCount = action("V-002", [{ condition: ["follow"], text: { th: "Follow" } }]);
  const noText = action("V-003", [{ condition: ["enter"], text: {} }]);
  const unreachable = action("V-004", [
    { condition: ["advantage"], text: { th: "ไม่มี trigger" }, resolve: (ctx) => ctx.draw(1) },
  ]);
  const vanilla = action("V-005", []);
  // The BP01-058 bug: printed "[Advantage] [Judgement]" but only `judgement`
  // in the condition, so the ability ran on every judgement instead of only
  // while holding Advantage. Invisible on screen — the text still reads
  // [Advantage] — which is why the validator has to be the one to see it.
  const tagNotInCondition = action("V-006", [
    {
      condition: ["judgement"],
      text: { th: "[Advantage] [Judgement] หากแพ้ ทำอะไรหน่อย" },
      resolve: (ctx) => ctx.draw(1),
    },
  ]);
  const leaderSkillWithoutCharacter = action("V-008", [
    {
      condition: ["leader", "judgement"],
      text: { th: "[Leader Skill] [Judgement] ไม่มีเจ้าของ" },
      resolve: (ctx) => ctx.draw(1),
    },
  ]);

  // A tag mid-sentence is prose about the effect, not a condition on it.
  const tagInProse = action("V-007", [
    {
      condition: ["judgement"],
      text: { th: "[Judgement] หากชนะ ได้รับ [Advantage] เทิร์นหน้า" },
      resolve: (ctx) => ctx.draw(1),
    },
  ]);

  check(
    "ฟ้าที่ใส่ speed -> จับได้ (ฟ้าไม่มี speed)",
    validateCard(blueWithSpeed).some((i) => i.field === "speed"),
    JSON.stringify(validateCard(blueWithSpeed))
  );
  check(
    "เขียวที่ไม่มี speed -> จับได้",
    validateCard(greenNoSpeed).some((i) => i.field === "speed")
  );
  check("Follow ที่ลืม followCount -> จับได้", validateCard(followNoCount).some((i) => i.field.endsWith("followCount")));
  check("effect ที่ไม่มี text -> จับได้", validateCard(noText).some((i) => i.field.endsWith("text")));
  check(
    "มี resolve แต่ไม่มี trigger/passive -> จับได้ว่าไม่มีวันรัน",
    validateCard(unreachable).some((i) => i.field.endsWith("condition")),
    JSON.stringify(validateCard(unreachable))
  );
  check("การ์ดที่ไม่มี effect เลย -> ผ่าน", validateCard(vanilla).length === 0);
  check(
    "ป้าย [Advantage] พิมพ์ไว้แต่ไม่ใส่ใน condition -> จับได้",
    validateCard(tagNotInCondition).some((i) => i.field.endsWith("condition")),
    JSON.stringify(validateCard(tagNotInCondition))
  );
  check(
    "Leader Skill ที่ไม่มีตัวละคร -> จับได้",
    validateCard(leaderSkillWithoutCharacter).some((i) => i.field === "character"),
    JSON.stringify(validateCard(leaderSkillWithoutCharacter))
  );
  check(
    "ป้ายกลางประโยค -> ไม่นับเป็นเงื่อนไข",
    validateCard(tagInProse).length === 0,
    JSON.stringify(validateCard(tagInProse))
  );
}

// 13. helpers -------------------------------------------------------------------
{
  const def = action("T-013", [
    { condition: ["enter"], text: { th: "a" }, resolve: () => {} },
    { condition: ["passive"], text: { th: "b" } },
  ]);
  check("triggerOf อ่าน trigger ออก", triggerOf(def.effects[0].condition) === "enter");
  check("passive ไม่ใช่ trigger", triggerOf(def.effects[1].condition) === null);
  check("isManual แยกใบที่ยังไม่เขียน resolve", !isManual(def.effects[0]) && isManual(def.effects[1]));
}

// 13b. [Leader] gates a triggered effect on being the ACTIVE leader ------------
{
  // On a CHARACTER card, [Leader] means "while this card is the active
  // Leader", so it only fires from the Leader slot.
  const character = defineCard({
    type: "leader",
    id: "T-013b",
    name: "T-013b",
    character: "T-013b",
    set: "BP01",
    imageId: "T-013b",
    level: 1,
    effects: [
      {
        condition: ["leader", "judgement"],
        text: { th: "ถ้าชนะ ดาเมจ 4 (ทำงานเฉพาะตอนเป็น leader)" },
        resolve: (ctx) => ctx.damage(4),
      },
    ],
  });

  const asLeader = resolveTrigger(freshState(), "judgement", [
    { card: character, controllerId: "p1", zone: "leader" },
  ]);
  const inBack = resolveTrigger(freshState(), "judgement", [
    { card: character, controllerId: "p1", zone: "back" },
  ]);

  check(
    "[Leader]+trigger: เป็น leader อยู่ -> ทำงาน",
    asLeader.resolved[0].status === "applied" && asLeader.state.boards.p2.life === 16,
    `p2life=${asLeader.state.boards.p2.life}`
  );
  check(
    "[Leader]+trigger: อยู่ back -> ไม่ทำงาน",
    inBack.resolved[0].status === "skipped" && inBack.state.boards.p2.life === 20,
    inBack.resolved[0].reason ?? ""
  );

  // On an ACTION card the same keyword is printed [Leader Skill] and means
  // "while the character this card belongs to is your Leader". The card sits
  // in the Action Area, so gating it on the Leader slot would kill it.
  const skill = defineCard({
    type: "action",
    id: "T-013c",
    name: "T-013c",
    character: "T-013b",
    set: "BP01",
    imageId: "T-013c",
    cost: 0,
    color: "red",
    speed: 1,
    attack: 1,
    effects: [
      {
        condition: ["leader", "judgement"],
        text: { th: "[Leader Skill] ถ้าชนะ ดาเมจ 4" },
        resolve: (ctx) => ctx.damage(4),
      },
    ],
  });

  const matching = freshState();
  matching.boards.p1.leader = { position: "leader", card: chara("T-013b"), under: [] };
  const withLeader = resolveTrigger(matching, "judgement", [
    { card: skill, controllerId: "p1", zone: "actionZone" },
  ]);
  const wrongLeader = resolveTrigger(freshState(), "judgement", [
    { card: skill, controllerId: "p1", zone: "actionZone" },
  ]);

  check(
    "[Leader Skill] บนการ์ดแอ็กชัน: ตัวละครเป็น Leader -> ทำงานจาก Action Area",
    withLeader.resolved[0].status === "applied" && withLeader.state.boards.p2.life === 16,
    `p2life=${withLeader.state.boards.p2.life}`
  );
  check(
    "[Leader Skill] บนการ์ดแอ็กชัน: ตัวละครไม่ได้เป็น Leader -> ไม่ทำงาน",
    wrongLeader.resolved[0].status === "skipped",
    wrongLeader.resolved[0].reason ?? ""
  );
}

// 14. i18n on text and notes ------------------------------------------------------
{
  check("ทั้งสองภาษามีครบ -> ได้ภาษาที่ขอ", localize({ en: "Hello", th: "สวัสดี" }, "th") === "สวัสดี");
  check("ขอ th แต่มีแค่ en -> fallback", localize({ en: "Hello" }, "th") === "Hello");
  check("ไม่มี notes เลย -> คืนค่าว่าง", localize(undefined, "en") === "");

  const bilingual = action("T-014", [
    {
      condition: ["enter", "follow"],
      followCount: 2,
      text: { en: "Draw two cards", th: "จั่ว 2 ใบ" },
      resolve: (ctx) => ctx.draw(2),
    },
  ]);
  check(
    "formatEffect ภาษาอังกฤษ ใส่ tag นำหน้า",
    formatEffect(bilingual.effects[0], "en") === "[Enter][Follow{2}] Draw two cards",
    formatEffect(bilingual.effects[0], "en")
  );
  check(
    "formatEffect ภาษาไทย ใช้ป้ายไทย",
    formatEffect(bilingual.effects[0], "th") === "[ลงสนาม][ฟอลโลว์{2}] จั่ว 2 ใบ",
    formatEffect(bilingual.effects[0], "th")
  );

  const thaiOnly = action("T-014b", [
    { condition: ["enter"], text: { th: "มีแค่ไทย" } },
  ]);
  check(
    "ขอ en แต่การ์ดมีแค่ไทย -> fallback ไม่หาย",
    formatEffect(thaiOnly.effects[0], "en") === "[Enter] มีแค่ไทย",
    formatEffect(thaiOnly.effects[0], "en")
  );

  // The imported text opens with its own printed tags, and the engine writes
  // the same keywords out from the conditions — showing both reads
  // "[ลงสนาม][เลเวลอัป] [Enter] / [Level up] ...".
  const printed = action("T-014c", [
    {
      condition: ["enter", "levelUp"],
      text: { th: "[Enter] / [Level up] นำการ์ดจากกองทิ้ง 1 ใบวางที่ Concerto area" },
    },
  ]);
  check(
    "ป้ายที่พิมพ์มาซ้ำกับป้ายของระบบ -> เหลือชุดเดียว",
    formatEffect(printed.effects[0], "th") ===
      "[ลงสนาม][เลเวลอัป] นำการ์ดจากกองทิ้ง 1 ใบวางที่ Concerto area",
    formatEffect(printed.effects[0], "th")
  );

  // Only the opening run goes. A tag mid-sentence is part of the wording,
  // and one inside a quoted ability belongs to that ability.
  const inline = action("T-014d", [
    {
      condition: ["judgement"],
      text: { th: "[Judgement] หากชนะ ได้รับ +8[follow-up attack]" },
    },
  ]);
  check(
    "ป้ายกลางประโยคไม่โดนตัดทิ้ง",
    formatEffect(inline.effects[0], "th") === "[ตัดสิน] หากชนะ ได้รับ +8[follow-up attack]",
    formatEffect(inline.effects[0], "th")
  );

  const unknown = action("T-014e", [
    { condition: ["counter"], text: { th: "[Something New] ยังไม่รู้จัก" } },
  ]);
  check(
    "ป้ายที่ยังไม่รู้จัก -> ไม่ตัด จะได้เห็นว่ามีอะไรตกหล่น",
    formatEffect(unknown.effects[0], "th") === "[ประลอง] [Something New] ยังไม่รู้จัก",
    formatEffect(unknown.effects[0], "th")
  );

  // --- colours, for the Detail panel ---------------------------------------
  const segments = effectSegments(inline.effects[0], "th");
  check(
    "effectSegments ต่อกลับเป็นข้อความเดิมได้",
    segments.map((seg) => seg.text).join("") === formatEffect(inline.effects[0], "th"),
    segments.map((seg) => seg.text).join("")
  );
  check(
    "ป้าย keyword ได้สีตามต้นทาง ทั้งหน้าประโยคและกลางประโยค",
    segments.filter((seg) => seg.color).map((seg) => `${seg.text}${seg.color}`).join() ===
      "[ตัดสิน]#ff8648,[follow-up attack]#3a87fe",
    segments.filter((seg) => seg.color).map((seg) => `${seg.text}${seg.color}`).join()
  );
  check(
    "คำธรรมดาไม่ได้สี",
    segments.filter((seg) => !seg.color).every((seg) => !/^\[/.test(seg.text))
  );
  check(
    "ป้ายที่ยังไม่รู้จัก -> ไม่ได้สี แต่ยังอยู่ในข้อความ",
    effectSegments(unknown.effects[0], "th").some(
      (seg) => !seg.color && seg.text.includes("[Something New]")
    )
  );

  check(
    "keywordForTag อ่านได้ทั้งชื่อที่พิมพ์บนการ์ดและชื่อที่ระบบเขียน",
    keywordForTag("Level up") === "levelUp" &&
      keywordForTag("เลเวลอัป") === "levelUp" &&
      keywordForTag("Leader Skill") === "leader" &&
      keywordForTag("ฟอลโลว์{8}") === "follow" &&
      keywordForTag("ไม่มีคำนี้") === null
  );

  // Every keyword the engine can print has a colour to print it in.
  check(
    "ทุก keyword มีสีกำกับครบ",
    CARD_KEYWORDS.every((keyword) => /^#[0-9a-f]{6}$/.test(KEYWORD_COLOR[keyword])),
    CARD_KEYWORDS.filter((keyword) => !KEYWORD_COLOR[keyword]).join()
  );
}

// 15. keyword bookkeeping stays in sync -----------------------------------------
{
  const buckets = [
    ...TRIGGER_KEYWORDS,
    ...CONTINUOUS_KEYWORDS,
    ...CONDITION_KEYWORDS,
    ...MODIFIER_KEYWORDS,
  ];
  check(
    "keyword ทุกตัวถูกจัดกลุ่มพอดี ไม่ซ้ำไม่ขาด",
    buckets.length === CARD_KEYWORDS.length && new Set(buckets).size === CARD_KEYWORDS.length,
    `${buckets.length} vs ${CARD_KEYWORDS.length}`
  );
  check(
    "keyword ทุกตัวมีชื่อแสดงผลทั้ง ไทย/อังกฤษ",
    CARD_KEYWORDS.every((k) => KEYWORD_LABEL[k]?.th && KEYWORD_LABEL[k]?.en)
  );
}

// 16. noLeaderSwitch blocks the effect-driven switch too ------------------------
{
  // SD02-010 sets noLeaderSwitch on [Counter]. Most in-game switches happen
  // through ctx.switchLeaderTo during Judgement/Combo, not the manual Action
  // move, so the flag has to bite here or the restriction does nothing.
  const switcher = action("T-016", [
    {
      condition: ["judgement"],
      text: { th: "สลับ Leader เป็น T-016b" },
      resolve: (ctx) => ctx.switchLeaderTo("T-016b"),
    },
  ]);

  const free = freshState();
  free.boards.p1.leader = { position: "leader", card: chara("T-016a"), under: [] };
  free.boards.p1.back = [{ position: "back", card: chara("T-016b"), under: [] }];
  const switched = resolveTrigger(free, "judgement", [
    { card: switcher, controllerId: "p1", zone: "actionZone" },
  ]);
  check(
    "ไม่มีข้อจำกัด -> switchLeaderTo สลับได้",
    switched.state.boards.p1.leader?.card.id === "T-016b",
    switched.state.boards.p1.leader?.card.id ?? "(null)"
  );

  const locked = freshState();
  locked.boards.p1.leader = { position: "leader", card: chara("T-016a"), under: [] };
  locked.boards.p1.back = [{ position: "back", card: chara("T-016b"), under: [] }];
  locked.turnLog.flags.p1 = ["noLeaderSwitch"];
  const blocked = resolveTrigger(locked, "judgement", [
    { card: switcher, controllerId: "p1", zone: "actionZone" },
  ]);
  check(
    "ติด noLeaderSwitch -> switchLeaderTo ไม่สลับ Leader คงเดิม",
    blocked.state.boards.p1.leader?.card.id === "T-016a" &&
      blocked.state.boards.p1.back[0]?.card.id === "T-016b",
    blocked.state.boards.p1.leader?.card.id ?? "(null)"
  );
}

// --- report ---------------------------------------------------------------------
let failed = 0;
for (const r of results) {
  if (!r.pass) failed += 1;
  console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.detail ? `  [${r.detail}]` : ""}`);
}
console.log(`\n${results.length - failed}/${results.length} passed`);
if (failed > 0) process.exit(1);
