// Lesson: how a turn runs, phase by phase.
//
//   turn 1 (you)   Draw 1 → Main: Charge → Battle: a cost-1 card → Judgement
//                  → Combo: two follow-ups from [Follow 2] → End
//   turn 2 (them)  their Battle Phase, and you Pass
//   turn 3 (you)   Draw 2 — and the recap
//
// Rulebook chapter 6 (600–605): 回合开始 → 抽卡 → 行动 → 对抗 (对抗/判定/连击)
// → 回合结束. The board's phase track folds Turn Start into Draw and splits
// the Battle Phase into Battle / Judgement / Combo, and the lesson follows
// the track, since that is what the player is looking at.

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
  theyCommitted,
} from "./lessonKit";

/**
 * Yangyang leads because her Leader Skill only answers a blue card, and the
 * player lays none. (Rover (F), the other obvious lead, reacts to green —
 * and the lesson's cost-1 card is green.)
 */
function setup(): MatchState {
  return dealLesson(
    "tutorial-phases",
    {
      characters: ["Yangyang", "Rover (F)", "Chixia"],
      cards: [
        "SD01-021", // green Rover (F) Grapple  cost 1, spd 8, [Judgement] draw 1 + [Follow 2]
        "SD01-017", // red   Basic Attack  dmg 1 spd 8 — follow-up
        "SD01-008", // blue  Dodge Counter — the card to Charge
        "SD01-012", // red   Basic Attack  dmg 1 spd 8 — follow-up
        "SD01-020", // green
        // draws
        "SD01-017", // turn 1
        "SD01-012", // off Grapple
        "SD01-013", "SD01-018", // turn 3
      ],
      filler: ["SD01-013", "SD01-020", "SD01-018"],
    },
    {
      characters: SPARRING_PARTNER,
      cards: [
        "SD02-008", // blue  Dodge Counter      turn 1: loses to green
        "SD02-017", // red   Basic Attack dmg 1 turn 2: lands unopposed
        "SD02-013",
        "SD02-018",
        "SD02-013",
      ],
      filler: SPARRING_FILLER,
    }
  );
}

const PHASES: [{ th: string; en: string }, { th: string; en: string }][] = [
  [
    { th: "Draw", en: "Draw" },
    {
      th: "เริ่มเทิร์น แล้วจั่วการ์ด (เทิร์นแรกของเกมจั่ว 1 ใบ หลังจากนั้นเทิร์นละ 2)",
      en: "The turn starts, then you draw (1 card on the game's very first turn, 2 every turn after)",
    },
  ],
  [
    { th: "Main", en: "Main" },
    { th: "เตรียมตัว: ชาร์จ / เลเวลอัป / สลับ Leader", en: "Get ready: Charge / Level Up / Switch" },
  ],
  [
    { th: "Battle", en: "Battle" },
    { th: "ทั้งสองฝ่ายคว่ำการ์ด แล้วเปิดพร้อมกัน", en: "Both sides lay a card face-down, then turn them up together" },
  ],
  [
    { th: "Judgement", en: "Judgement" },
    { th: "ตัดสินผู้ชนะ ความสามารถ [Judgement] ทำงาน แล้วผู้ชนะทำดาเมจ", en: "The winner is decided, [Judgement] abilities fire, then the winner deals damage" },
  ],
  [
    { th: "Combo", en: "Combo" },
    { th: "ผู้ชนะโจมตีต่อด้วยการ์ดแดง", en: "The winner follows up with red cards" },
  ],
  [
    { th: "End", en: "End" },
    { th: "เก็บการ์ดลงกองทิ้ง ทิ้งมือให้เหลือ 8 แล้วส่งเทิร์น", en: "Clear the Action Area, discard down to 8, pass the turn" },
  ],
];

const steps: GuideStep[] = [
  {
    id: "track",
    title: { th: "เทิร์นหนึ่งมีอะไรบ้าง", en: "What happens in a turn" },
    body: {
      th: "แถบตรงกลางกระดานบอกว่าตอนนี้อยู่เฟสไหน ทุกเทิร์นเดินตามลำดับนี้เสมอ",
      en: "The track across the middle of the board shows which phase the turn is in. Every turn runs in this order.",
    },
    figure: { kind: "table", rows: PHASES },
    highlight: [at.phases],
    advance: { next: true },
  },

  // --- Turn 1 -------------------------------------------------------------------
  {
    id: "draw",
    title: { th: "เฟสจั่ว", en: "Draw Phase" },
    body: { th: "เทิร์นของคุณเริ่มแล้ว…", en: "Your turn begins…" },
    highlight: [at.phase("draw"), at.deck],
    advance: { until: myMainPhase },
  },
  {
    id: "drew",
    title: { th: "จั่ว 1 ใบ", en: "You drew 1" },
    body: {
      th:
        "เกมนี้คุณได้เริ่มก่อน เทิร์นแรกของเกมจึงจั่วแค่ 1 ใบ — ตั้งแต่เทิร์นถัดไป ทุกคนจั่วเทิร์นละ 2 ใบ\n" +
        "จั่วเสร็จก็เข้าเฟส Main เอง",
      en:
        "You went first, so the game's first turn draws just 1 — from the next turn on, everyone draws 2.\n" +
        "After the draw, the turn moves into Main by itself.",
    },
    highlight: [at.deck, at.anyHand],
    advance: { next: true },
  },
  {
    id: "main",
    title: { th: "เฟส Main", en: "Main Phase" },
    body: {
      th:
        "เฟสเตรียมตัวก่อนประลอง ทำได้ 3 อย่าง อย่างละไม่เกิน 1 ครั้งต่อเทิร์น จะทำอะไรก่อนก็ได้ หรือไม่ทำเลยก็ได้\n" +
        "เลเวลอัปกับสลับ Leader มีบทเรียนของมันเอง บทนี้ลองชาร์จกัน",
      en:
        "The phase to get ready before the battle. Three things, each at most once a turn, in any order — or not at all.\n" +
        "Level Up and Switch have a lesson of their own. This one tries Charge.",
    },
    figure: {
      kind: "table",
      rows: [
        [
          { th: "ชาร์จ", en: "Charge" },
          { th: "วางการ์ดจากมือ 1 ใบที่ Concerto ไว้จ่าย cost", en: "Put 1 card from hand into the Concerto area, to pay costs with" },
        ],
        [
          { th: "เลเวลอัป", en: "Level Up" },
          { th: "วางตัวละครเลเวลสูงขึ้นทับตัวเดิม", en: "Play a higher level of a character on top of it" },
        ],
        [
          { th: "สลับ", en: "Switch" },
          { th: "สลับ Leader กับตัวละครด้านหลัง", en: "Swap the Leader with a back character" },
        ],
      ],
    },
    highlight: [at.phase("main"), at.concerto, at.characters],
    advance: { next: true },
  },
  {
    id: "charge",
    title: { th: "ชาร์จ", en: "Charge" },
    body: {
      th: "ลากการ์ดสีน้ำเงินใบนี้ไปวางที่ช่อง Concerto (ซ้ายมือ) หรือคลิกการ์ดแล้วเลือก \"ชาร์จ\"",
      en: "Drag this blue card onto the Concerto area (on the left), or click it and choose \"Charge\".",
    },
    highlight: [at.handCard("SD01-008"), at.concerto],
    advance: { move: { kind: "charge", card: "SD01-008" } },
  },
  {
    id: "cost",
    title: { th: "Cost", en: "Cost" },
    body: {
      th:
        "ตอนนี้ Concerto มี 1 ใบ = จ่าย cost ได้ 1\n" +
        "ตัวเลขมุมซ้ายบนของการ์ดคือ cost การ์ดเขียว Grapple ใบนี้ cost 1\n" +
        "cost จ่ายตอนการ์ดถูกเปิด โดยย้ายการ์ดจาก Concerto ลงกองทิ้งตามจำนวน cost",
      en:
        "The Concerto area holds 1 card now — 1 cost you can pay.\n" +
        "The number in a card's top-left corner is its cost. This green Grapple costs 1.\n" +
        "A cost is paid when the card is turned up, by moving that many cards from Concerto to the trash.",
    },
    highlight: [at.concerto, at.handCard("SD01-021")],
    advance: { next: true },
  },
  {
    id: "go-battle",
    title: { th: "ไปเฟสประลอง", en: "On to the Battle" },
    body: {
      th:
        "เตรียมตัวเสร็จแล้ว กด Go Battle\n" +
        "(ปุ่มข้าง ๆ คือ \"ข้ามเฟสประลอง\" — ไปจบเทิร์นเลยโดยไม่ประลอง แต่อีกฝ่ายจะได้ Advantage ในเทิร์นถัดไป)",
      en:
        "Ready. Press Go Battle.\n" +
        "(The button beside it skips the Battle Phase — straight to the end of the turn, no clash — but the other side gains Advantage for their next turn.)",
    },
    highlight: [at.goBattle, at.skipBattle],
    advance: { move: { kind: "toBattle" } },
  },
  {
    id: "commit",
    title: { th: "เฟส Battle", en: "Battle Phase" },
    body: {
      th: "คว่ำการ์ดเขียว Grapple (cost 1) ลงช่องแอ็กชัน",
      en: "Lay the green Grapple (cost 1) face-down in your Action Area.",
    },
    highlight: [at.handCard("SD01-021"), at.mySlot],
    advance: { move: { kind: "commit", card: "SD01-021" } },
  },
  {
    id: "wait",
    title: { th: "อีกฝ่ายกำลังเลือก…", en: "They are choosing…" },
    body: { th: "อีกฝ่ายคว่ำการ์ดตอบ แล้วเปิดพร้อมกัน", en: "They lay a card in answer; then both are turned up." },
    highlight: [at.theirSlot],
    foe: [{ kind: "commit", card: "SD02-008" }],
    advance: { until: revealed },
  },
  {
    id: "judgement",
    title: { th: "เฟส Judgement", en: "Judgement" },
    body: {
      th:
        "การ์ดเปิดแล้ว cost 1 ถูกจ่าย: การ์ดใน Concerto ย้ายลงกองทิ้ง\n" +
        "เขียวชนะน้ำเงิน → ความสามารถ [Judgement] ของ Grapple ทำงาน: จั่ว 1 ใบ และได้ [Follow 2] (โจมตีต่อได้ 2 ครั้ง)\n" +
        "แล้วผู้ชนะทำดาเมจ — Grapple ดาเมจ 0",
      en:
        "The cards are up and the 1 cost is paid: the Concerto card moves to the trash.\n" +
        "Green beats blue → Grapple's [Judgement] fires: draw 1, and [Follow 2] (two follow-ups).\n" +
        "Then the winner deals damage — Grapple's is 0.",
    },
    highlight: [at.phase("judgement"), at.concerto, at.trash],
    delayMs: AFTER_REVEAL,
    advance: { next: true },
  },
  {
    id: "combo-1",
    title: { th: "เฟส Combo", en: "Combo" },
    body: {
      th: "ผู้ชนะโจมตีต่อ: คลิกการ์ดแดงในมือ (ครั้งที่ 1 จาก 2)",
      en: "The winner follows up: click a red card in your hand (1 of 2).",
    },
    highlight: [at.phase("combo"), at.hand("red")],
    advance: { move: { kind: "combo", color: "red" } },
  },
  {
    id: "combo-2",
    title: { th: "อีกครั้ง", en: "Once more" },
    body: { th: "คลิกการ์ดแดงอีกใบ (ครั้งที่ 2 จาก 2)", en: "Click another red card (2 of 2)." },
    highlight: [at.hand("red"), at.theirLife],
    advance: { move: { kind: "combo", color: "red" } },
  },
  {
    id: "end",
    title: { th: "เฟส End", en: "End Phase" },
    body: {
      th:
        "ใช้ครบ 2 ครั้งแล้ว เทิร์นจึงเข้าเฟส End เอง:\n" +
        "• การ์ดในช่องแอ็กชันของทั้งสองฝ่ายลงกองทิ้ง\n" +
        "• ถ้าเจ้าของเทิร์นมีการ์ดในมือเกิน 8 ใบ ต้องทิ้งให้เหลือ 8\n" +
        "• แล้วส่งเทิร์นให้อีกฝ่าย",
      en:
        "Both follow-ups are spent, so the turn moves to End by itself:\n" +
        "• both Action Areas go to the trash\n" +
        "• if the turn player holds more than 8 cards, they discard down to 8\n" +
        "• and the turn passes to the other side",
    },
    highlight: [at.phase("end"), at.mySlot, at.theirSlot],
    advance: { next: true },
  },

  // --- Turn 2: theirs -------------------------------------------------------------
  {
    id: "their-turn",
    title: { th: "เทิร์นของอีกฝ่าย", en: "Their turn" },
    body: {
      th: "อีกฝ่ายเดินตามเฟสเดียวกัน เมื่อเขาเข้าเฟสประลอง คุณก็ต้องเลือกเหมือนกันว่าจะลงการ์ดตอบหรือไม่",
      en: "They go through the same phases. When they enter the Battle Phase, you choose too: answer with a card, or not.",
    },
    foe: [{ kind: "toBattle" }, { kind: "commit", card: "SD02-017" }],
    highlight: [at.phases],
    advance: { until: theyCommitted },
  },
  {
    id: "pass",
    title: { th: "ลองกด Pass", en: "Try Pass" },
    body: {
      th:
        "ฝ่ายที่ไม่ใช่เจ้าของเทิร์นเลือกไม่ลงการ์ดได้เสมอ — กด Pass\n" +
        "แพ้การประลองนี้ไป แต่ไม่เสียการ์ดสักใบ\n" +
        "(เจ้าของเทิร์นไม่มีสิทธิ์นี้: ต้องลงถ้ามีใบที่ลงได้)",
      en:
        "The player whose turn it is NOT may always lay nothing — press Pass.\n" +
        "You lose this clash, but keep every card.\n" +
        "(The turn player has no such choice: they must lay a card if they have one they can play.)",
    },
    highlight: [at.pass],
    advance: { move: { kind: "pass" } },
  },
  {
    id: "pass-wait",
    title: { th: "เปิดการ์ด!", en: "Turning them up!" },
    body: { th: "…", en: "…" },
    advance: { until: revealed },
  },
  {
    id: "passed",
    title: { th: "ชนะแบบไม่มีคู่ต่อสู้", en: "Unopposed" },
    body: {
      th: "คุณไม่ได้ลงการ์ด การ์ดของอีกฝ่ายจึงชนะไปเลยและทำดาเมจ 1 — เขาชนะด้วยแดงจึงโจมตีต่อได้ แต่รอบนี้เขาจบเทิร์นไป",
      en: "You laid nothing, so their card wins outright and hits for 1. It won with red, so they could follow up — this time they end the turn.",
    },
    highlight: [at.myLife, at.theirSlot],
    delayMs: AFTER_REVEAL,
    advance: { next: true },
  },

  // --- Turn 3 ------------------------------------------------------------------------
  {
    id: "draw-2",
    title: { th: "เทิร์นของคุณ", en: "Your turn" },
    body: { th: "เทิร์นใหม่ของคุณเริ่มแล้ว…", en: "Your next turn begins…" },
    highlight: [at.phase("draw"), at.deck],
    advance: { until: myMainPhase },
  },
  {
    id: "drew-2",
    title: { th: "จั่ว 2 ใบ", en: "You drew 2" },
    body: {
      th:
        "ไม่ใช่เทิร์นแรกของเกมแล้ว จึงจั่ว 2 ใบ\n" +
        "ระวัง: ถ้าการ์ดในเด็คและกองทิ้งหมดทั้งคู่ คุณแพ้ — เช่นเดียวกับเมื่อพลังชีวิตเหลือ 0",
      en:
        "It is no longer the game's first turn, so you draw 2.\n" +
        "Careful: with no cards left in both your deck and your trash, you lose — just as you do at 0 Life.",
    },
    highlight: [at.deck, at.anyHand],
    advance: { next: true },
  },
  {
    id: "summary",
    title: { th: "สรุป", en: "Summary" },
    body: {
      th: "นี่คือทุกเฟสของหนึ่งเทิร์น ต่อไปลองบท \"เลเวลอัปและสลับ Leader\" ได้เลย",
      en: "That is every phase of a turn. \"Level Up and Switch\" is a good next lesson.",
    },
    figure: { kind: "table", rows: PHASES },
    advance: { next: true },
  },
];

export const phaseLesson: Lesson = {
  id: "phases",
  title: { th: "ลำดับเทิร์นและเฟส", en: "Turns and phases" },
  blurb: {
    th: "จั่ว, Main (ชาร์จและ cost), Battle, Judgement, Combo, End และการ Pass",
    en: "Draw, Main (Charge and cost), Battle, Judgement, Combo, End — and passing",
  },
  setup,
  steps,
};
