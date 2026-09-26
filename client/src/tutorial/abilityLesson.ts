// Lesson: reading a card's abilities, and when each kind fires.
//
//   turn 1 (you)   Chixia leads: her [Leader] [Counter] hits for 1 when a red
//                  card is turned up; the red card's [Judgement] draws on the
//                  win; the follow-up's [Combo] offers a discard for +1
//   turn 2 (them)  they skip the Battle Phase → you gain [Advantage]
//   turn 3 (you)   a [Leader Skill] card: Charge for its cost, Switch to its
//                  character, play it — and Chixia's [Leader] goes quiet
//
// Rulebook 604.1.1.5–604.1.2.5 for the order inside a battle: turn up, pay,
// [Counter] (对抗), decide the winner, [Judgement] (判定), then damage.
// 912.2 for [Leader Skill] (领队技), 913.6 for [Leader] (领队), 913.13 for
// [Advantage] (优势).

import type { MatchState } from "@wuwatcg/shared";
import type { GuideStep, Lesson } from "./director";
import {
  AFTER_REVEAL,
  SPARRING_FILLER,
  SPARRING_PARTNER,
  at,
  dealLesson,
  myMainPhase,
  revealed,
} from "./lessonKit";

function setup(): MatchState {
  return dealLesson(
    "tutorial-abilities",
    {
      characters: ["Chixia", "Rover (F)", "Yangyang"],
      cards: [
        "BP01-066", // red Rover (F) Mid-air Attack  dmg 1 spd 6  [Judgement] win: draw 1
        "BP01-065", // red Rover (F) Heavy Attack    dmg 1 spd 6  [Combo] may discard 1: +1 damage
        "SD01-022", // red Rover (F) Resonating Slashes  cost 1 dmg 1 spd 16  [Leader Skill]
        "SD01-020", // green — charged on turn 3
        "SD01-013", // blue
        // draws
        "SD01-012", // turn 1
        "SD01-018", // off BP01-066's [Judgement]
        "SD01-013", "SD01-020", // turn 3
      ],
      filler: ["SD01-013", "SD01-020", "SD01-018"],
    },
    {
      characters: SPARRING_PARTNER,
      cards: [
        "SD02-020", // green Sensor            turn 1: loses to red
        "SD02-017", // red   Basic Attack spd 8 turn 3: loses to Speed 16
        "SD02-013",
        "SD02-018",
        "SD02-013",
      ],
      filler: SPARRING_FILLER,
    }
  );
}

const KEYWORDS: [{ th: string; en: string }, { th: string; en: string }][] = [
  [{ th: "[Enter]", en: "[Enter]" }, { th: "เมื่อการ์ดขึ้นสนาม / ถูกเปิด", en: "When the card comes onto the field / is turned up" }],
  [{ th: "[Counter]", en: "[Counter]" }, { th: "ตอนเปิดการ์ดประลอง ก่อนตัดสินผล", en: "As the battle cards are turned up, before the result" }],
  [{ th: "[Judgement]", en: "[Judgement]" }, { th: "หลังรู้ผู้ชนะ ก่อนทำดาเมจ", en: "Once the winner is known, before damage" }],
  [{ th: "[Combo]", en: "[Combo]" }, { th: "เมื่อลงการ์ดใบนี้เป็น follow-up", en: "When this card is played as a follow-up" }],
  [{ th: "[At start of own turn]", en: "[At start of own turn]" }, { th: "ตอนเริ่มเทิร์นของคุณ", en: "As your turn begins" }],
  [{ th: "[Leader]", en: "[Leader]" }, { th: "ใช้ได้เฉพาะตอนอยู่ช่อง Leader", en: "Only while in the Leader slot" }],
  [{ th: "[Leader Skill]", en: "[Leader Skill]" }, { th: "ลงได้เฉพาะเมื่อ Leader เป็นตัวละครของการ์ด", en: "Playable only while your Leader is its character" }],
  [{ th: "[Advantage]", en: "[Advantage]" }, { th: "ใช้ได้เมื่อเทิร์นก่อนชนะการประลอง หรืออีกฝ่ายข้ามเฟสประลอง", en: "Works if you won the last clash, or they skipped the Battle Phase" }],
  [{ th: "[Follow X]", en: "[Follow X]" }, { th: "โจมตีต่อได้เพิ่ม X ครั้ง", en: "X more follow-ups" }],
];

const steps: GuideStep[] = [
  {
    id: "read",
    title: { th: "อ่านความสามารถ", en: "Reading an ability" },
    body: {
      th:
        "เอาเมาส์ชี้การ์ดใบไหนก็ได้ (บนมือถือ: กดค้าง) รายละเอียดจะขึ้นที่ช่อง Detail ด้านขวา\n" +
        "คำในวงเล็บเหลี่ยม เช่น [Judgement] บอกว่าความสามารถนั้นทำงาน \"ตอนไหน\" หรือ \"เมื่อไหร่ถึงใช้ได้\"",
      en:
        "Point at any card (on a phone: press and hold) and its details appear in the Detail panel on the right.\n" +
        "The words in square brackets, like [Judgement], say WHEN an ability fires, or WHEN it is allowed to work.",
    },
    highlight: [at.detail, at.anyHand],
    advance: { next: true },
  },
  {
    id: "keywords",
    title: { th: "คำที่เจอบ่อย", en: "The common ones" },
    body: { th: "ไม่ต้องจำตอนนี้ — บทนี้จะได้เห็นส่วนใหญ่ทำงานจริง", en: "No need to memorise these — you will see most of them work in this lesson." },
    figure: { kind: "table", rows: KEYWORDS },
    advance: { next: true },
  },
  {
    id: "leader",
    title: { th: "[Leader] ของ Chixia", en: "Chixia's [Leader] ability" },
    body: {
      th:
        "Leader ของคุณคือ Chixia: \"[Leader] [Counter] ถ้าประลองด้วยการ์ดสีแดง ทำ 1 ดาเมจใส่อีกฝ่าย\"\n" +
        "[Leader] = ทำงานเฉพาะตอนอยู่ช่อง Leader / [Counter] = ทำงานตอนเปิดการ์ดประลอง",
      en:
        "Your Leader is Chixia: \"[Leader] [Counter] If you counter with a red card, deal 1 damage to your opponent.\"\n" +
        "[Leader] = only while in the Leader slot. [Counter] = as the battle cards are turned up.",
    },
    highlight: [at.leader, at.detail],
    advance: { next: true },
  },
  {
    id: "go-battle",
    title: { th: "ไปเฟสประลอง", en: "To battle" },
    body: { th: "กด Go Battle", en: "Press Go Battle." },
    highlight: [at.goBattle],
    advance: { move: { kind: "toBattle" } },
  },
  {
    id: "commit",
    title: { th: "การ์ดที่มี [Judgement]", en: "A card with [Judgement]" },
    body: {
      th: "คว่ำการ์ดแดงใบนี้: \"[Judgement] ถ้าชนะ จั่วการ์ด 1 ใบ\"",
      en: "Lay this red card: \"[Judgement] If you win, draw 1 card.\"",
    },
    figure: { kind: "cards", cards: ["BP01-066"] },
    highlight: [at.handCard("BP01-066"), at.mySlot],
    advance: { move: { kind: "commit", card: "BP01-066" } },
  },
  {
    id: "wait",
    title: { th: "อีกฝ่ายกำลังเลือก…", en: "They are choosing…" },
    body: { th: "ดูลำดับที่เกิดขึ้นใน Battle Log ด้วย", en: "Watch the order things happen in the battle log too." },
    highlight: [at.theirSlot],
    foe: [{ kind: "commit", card: "SD02-020" }],
    advance: { until: revealed },
  },
  {
    id: "order",
    title: { th: "ลำดับการทำงาน", en: "What fired, and when" },
    body: {
      th:
        "1. เปิดการ์ด → [Counter]: Chixia ทำ 1 ดาเมจทันที (ยังไม่รู้ผลแพ้ชนะด้วยซ้ำ)\n" +
        "2. ตัดสิน: แดงชนะเขียว\n" +
        "3. [Judgement]: การ์ดของคุณชนะ จึงจั่ว 1 ใบ\n" +
        "4. ทำดาเมจ: อีก 1 — อีกฝ่ายเหลือ 18",
      en:
        "1. Cards turned up → [Counter]: Chixia deals 1 at once (before the winner is even known)\n" +
        "2. The result: red beats green\n" +
        "3. [Judgement]: your card won, so you draw 1\n" +
        "4. Damage: 1 more — they are at 18",
    },
    highlight: [at.theirLife, at.anyHand],
    delayMs: AFTER_REVEAL,
    advance: { next: true },
  },
  {
    id: "combo",
    title: { th: "การ์ดที่มี [Combo]", en: "A card with [Combo]" },
    body: {
      th:
        "โจมตีต่อด้วยการ์ดใบนี้: \"[Combo] ทิ้งการ์ด 1 ใบได้ ถ้าทิ้ง การ์ดนี้ดาเมจ +1\"\n" +
        "[Combo] ทำงานเฉพาะตอนลงเป็น follow-up เท่านั้น — ถ้าใช้ประลองตรง ๆ จะไม่ทำงาน\n" +
        "จะทิ้งหรือไม่ก็เลือกได้",
      en:
        "Follow up with this card: \"[Combo] You may discard 1 card; if you do, this card gains +1 damage.\"\n" +
        "[Combo] fires only when the card is played as a follow-up — laid in the clash itself, it does nothing.\n" +
        "Discard or not — your call.",
    },
    figure: { kind: "cards", cards: ["BP01-065"] },
    highlight: [at.handCard("BP01-065")],
    advance: { move: { kind: "combo", card: "BP01-065" } },
  },
  {
    id: "end-1",
    title: { th: "จบเทิร์น", en: "End the turn" },
    body: { th: "กด End Turn", en: "Press End Turn." },
    highlight: [at.endTurn, at.theirLife],
    advance: { move: { kind: "endTurn" } },
  },

  // --- Turn 2: theirs -----------------------------------------------------------------
  {
    id: "their-turn",
    title: { th: "เทิร์นของอีกฝ่าย", en: "Their turn" },
    body: { th: "…", en: "…" },
    foe: [{ kind: "skipCounter" }],
    advance: { until: myMainPhase },
  },
  {
    id: "advantage",
    title: { th: "[Advantage]", en: "[Advantage]" },
    body: {
      th:
        "อีกฝ่ายข้ามเฟสประลองไป เทิร์นนี้คุณจึงถือ Advantage (◈Adv ข้างชื่อ)\n" +
        "ความสามารถที่มีป้าย [Advantage] ทำงานได้เฉพาะตอนถือมัน — ได้มาจากการชนะการประลองเทิร์นก่อน หรือเมื่ออีกฝ่ายข้ามเฟสประลอง\n" +
        "(เทิร์นแรกของเกมไม่มีใครถือ Advantage)",
      en:
        "They skipped their Battle Phase, so this turn you hold Advantage (the ◈Adv by your name).\n" +
        "[Advantage] abilities only work while you hold it — you get it by winning the previous clash, or when the other side skips their Battle Phase.\n" +
        "(Nobody holds it on the game's first turn.)",
    },
    highlight: [at.myAdvantage],
    advance: { next: true },
  },

  // --- Turn 3 ------------------------------------------------------------------------------
  {
    id: "leader-skill",
    title: { th: "การ์ด [Leader Skill]", en: "A [Leader Skill] card" },
    body: {
      th:
        "Resonating Slashes เป็นการ์ด [Leader Skill] ของ Rover (F): ลงได้เฉพาะเมื่อ Leader คือ Rover (F)\n" +
        "ตอนนี้ Leader คือ Chixia จึงยังลงไม่ได้ และมันยังมี cost 1\n" +
        "ต้องเตรียม 2 อย่าง: ชาร์จ 1 ใบ และสลับ Leader เป็น Rover (F)",
      en:
        "Resonating Slashes is a Rover (F) [Leader Skill] card: it can only be played while your Leader is Rover (F).\n" +
        "Your Leader is Chixia, so not yet — and it costs 1 as well.\n" +
        "Two things to set up: Charge a card, and Switch Rover (F) into the Leader slot.",
    },
    figure: { kind: "cards", cards: ["SD01-022"] },
    highlight: [at.handCard("SD01-022"), at.leader],
    advance: { next: true },
  },
  {
    id: "charge",
    title: { th: "ชาร์จ", en: "Charge" },
    body: {
      th: "ลากการ์ดเขียวไปที่ Concerto (หรือคลิกแล้วเลือก \"ชาร์จ\")",
      en: "Drag the green card onto the Concerto area (or click it and choose \"Charge\").",
    },
    highlight: [at.hand("green"), at.concerto],
    advance: { move: { kind: "charge", color: "green" } },
  },
  {
    id: "switch",
    title: { th: "สลับเป็น Rover (F)", en: "Switch to Rover (F)" },
    body: {
      th: "คลิก Rover (F) → \"สลับ\" (หรือลากไปวางบน Leader)",
      en: "Click Rover (F) → \"Switch\" (or drag her onto the Leader).",
    },
    highlight: [at.character("Rover (F)")],
    advance: { move: { kind: "switch", card: "BP01-018" } },
  },
  {
    id: "go-battle-2",
    title: { th: "ไปเฟสประลอง", en: "To battle" },
    body: {
      th: "Chixia ไปอยู่ด้านหลังแล้ว ความสามารถ [Leader] ของเธอจึงหยุดทำงาน กด Go Battle",
      en: "Chixia has moved to the back, so her [Leader] ability stops working. Press Go Battle.",
    },
    highlight: [at.goBattle, at.character("Chixia")],
    advance: { move: { kind: "toBattle" } },
  },
  {
    id: "commit-2",
    title: { th: "ลงการ์ด [Leader Skill]", en: "Play the [Leader Skill] card" },
    body: { th: "คว่ำ Resonating Slashes (Speed 16)", en: "Lay Resonating Slashes (Speed 16)." },
    highlight: [at.handCard("SD01-022"), at.mySlot],
    advance: { move: { kind: "commit", card: "SD01-022" } },
  },
  {
    id: "wait-2",
    title: { th: "อีกฝ่ายกำลังเลือก…", en: "They are choosing…" },
    body: { th: "…", en: "…" },
    highlight: [at.theirSlot],
    foe: [{ kind: "commit", card: "SD02-017" }],
    advance: { until: revealed },
  },
  {
    id: "result-2",
    title: { th: "Speed 16 ชนะ 8", en: "Speed 16 beats 8" },
    body: {
      th:
        "แดงเจอแดง Speed ของคุณสูงกว่า ชนะและทำดาเมจ 1 — cost 1 จ่ายจาก Concerto ตอนเปิดการ์ด\n" +
        "สังเกตว่ารอบนี้ Chixia ไม่ทำดาเมจ [Counter] แล้ว เพราะไม่ได้เป็น Leader",
      en:
        "Red against red and your Speed is higher: you win and deal 1. The 1 cost came out of Concerto as the card turned up.\n" +
        "And this time Chixia dealt no [Counter] damage — she is not the Leader any more.",
    },
    highlight: [at.theirLife, at.concerto, at.character("Chixia")],
    delayMs: AFTER_REVEAL,
    advance: { next: true },
  },
  {
    id: "end-2",
    title: { th: "จบเทิร์น", en: "End the turn" },
    body: { th: "กด End Turn", en: "Press End Turn." },
    highlight: [at.endTurn],
    advance: { move: { kind: "endTurn" } },
  },
  {
    id: "summary",
    title: { th: "สรุป", en: "Summary" },
    body: {
      th: "เจอคำไหนไม่แน่ใจ ชี้การ์ดแล้วอ่านที่ช่อง Detail ได้เสมอ",
      en: "Unsure of a word? Point at the card and read it in the Detail panel.",
    },
    figure: { kind: "table", rows: KEYWORDS },
    advance: { next: true },
  },
];

export const abilityLesson: Lesson = {
  id: "abilities",
  title: { th: "ความสามารถการ์ด", en: "Card abilities" },
  blurb: {
    th: "อ่านความสามารถ, [Counter] / [Judgement] / [Combo] ทำงานตอนไหน, [Leader], [Leader Skill] และ [Advantage]",
    en: "Reading abilities; when [Counter], [Judgement] and [Combo] fire; [Leader], [Leader Skill] and [Advantage]",
  },
  setup,
  steps,
};
