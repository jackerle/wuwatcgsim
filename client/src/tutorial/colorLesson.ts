// Lesson: which colour beats which, and everything that follows from a win.
//
// Six turns, each one clash, each one a different way a clash can go:
//
//   1  red beats green          you win on your turn; red opens unlimited follow-ups
//   2  green beats blue         you answer on their turn; green deals 0, [Follow] gives follow-ups
//   3  blue beats red           you guess wrong and take the hit
//   4  same colour: Speed       8 beats 7
//   5  same colour, same Speed  the turn player wins
//   6  blue meets blue          a draw — nothing happens at all
//
// The rules are 604.1.2 of the rulebook (综合规则书): colour first
// (红>绿>蓝>红), then Speed for red and green, a draw for blue on blue, ties
// to the turn player; damage is the winning card's; red wins open unlimited
// follow-ups, any other colour only its own [Follow X]; a follow-up is always
// a red card. The engine already plays it that way (resolveCombat), so what
// the lesson shows is what a real match does.
//
// Both decks are dealt in a fixed order, and every card the script plays
// costs 0 and does nothing of its own beyond what the lesson explains — so the
// numbers on the board are exactly the numbers in the text.

import type { MatchState } from "@wuwatcg/shared";
import type { GuideStep, Lesson } from "./director";
import { AFTER_REVEAL, SPARRING_FILLER, SPARRING_PARTNER, at, dealLesson, revealed, theyCommitted } from "./lessonKit";

// --- The deal ----------------------------------------------------------------

/**
 * Yangyang leads because her Level 0 Leader Skill only wakes up for a blue
 * card, and the player lays one blue card in the whole lesson. Every other
 * starting Leader here reacts to red or green, which the lesson plays all
 * the time — and a surprise point of damage would make the arithmetic in the
 * text wrong.
 */
function setup(): MatchState {
  return dealLesson(
    "tutorial-colors",
    {
      characters: ["Yangyang", "Rover (F)", "Chixia"],
      // Every red card is 1 damage, Speed 8 — exactly six of them, one for
      // each red the lesson asks for, so whichever the player picks, Speed 8
      // is what it has.
      cards: [
        "SD01-017", // red   Rover (F) Basic Attack   dmg 1 spd 8
        "SD01-012", // red   Yangyang Basic Attack    dmg 1 spd 8
        "SD01-015", // green Yangyang Jump            dmg 0 spd 7   turn 2: [Follow 1], draw 1
        "SD01-017", // red
        "SD01-008", // blue  Chixia Dodge Counter     dmg 3         turn 6
        // draws
        "SD01-012", // turn 1
        "SD01-017", // turn 2, off Jump
        "SD01-012", "SD01-020", // turn 3
        "SD01-013", "SD01-020", // turn 5
      ],
      filler: ["SD01-013", "SD01-020", "SD01-018"],
    },
    {
      characters: SPARRING_PARTNER,
      cards: [
        "SD02-020", // green Rover (M) Sensor         spd 5        turn 1
        "SD02-008", // blue  Jinshi Dodge Counter     dmg 3        turn 2
        "SD02-007", // red   Jinshi Basic Attack      dmg 1 spd 7  turn 4
        "SD02-017", // red   Rover (M) Basic Attack   dmg 1 spd 8  turn 5
        "SD02-008", // blue                                        turn 3
        // draws
        "SD02-008", "SD02-018", // turn 2 — the blue for turn 6
        "SD02-013", "SD02-018", // turn 4
        "SD02-013", "SD02-018", // turn 6
      ],
      filler: SPARRING_FILLER,
    }
  );
}

// --- The script -----------------------------------------------------------------

const steps: GuideStep[] = [
  {
    id: "intro",
    title: { th: "สีแพ้ชนะ", en: "Colours" },
    body: {
      th:
        "การ์ด Action มี 3 สี: แดง เขียว น้ำเงิน\n" +
        "ในเฟสประลอง (Battle) ทั้งสองฝ่ายคว่ำการ์ดฝ่ายละ 1 ใบ แล้วเปิดพร้อมกัน — สีคือสิ่งแรกที่ตัดสินว่าใครชนะ\n" +
        "• แดง ชนะ เขียว\n• เขียว ชนะ น้ำเงิน\n• น้ำเงิน ชนะ แดง",
      en:
        "Action cards come in 3 colours: red, green and blue.\n" +
        "In the Battle Phase each side lays one card face-down, then both are turned up together — and colour is the first thing that decides who wins.\n" +
        "• Red beats green\n• Green beats blue\n• Blue beats red",
    },
    figure: { kind: "triangle" },
    advance: { next: true },
  },
  {
    id: "read-card",
    title: { th: "อ่านการ์ดในมือ", en: "Reading a card" },
    body: {
      th:
        "ตัวอักษรบนการ์ดบอกสี (R แดง / G เขียว / B น้ำเงิน)\n" +
        "ตัวเลขด้านล่างคือ ดาเมจ และ Speed ตามลำดับ — ดาเมจคือแรงที่ทำได้เมื่อชนะ ส่วน Speed ใช้ตัดสินตอนสีเดียวกัน\n" +
        "การ์ดทุกใบในบทเรียนนี้ cost 0 จึงลงได้เลยโดยไม่ต้องชาร์จ",
      en:
        "The letter on each card is its colour (R red / G green / B blue).\n" +
        "The numbers along the bottom are Damage, then Speed — damage is what it hits for when it wins, Speed settles a clash between two cards of the same colour.\n" +
        "Every card in this lesson costs 0, so there is nothing to charge first.",
    },
    highlight: [at.handBadges, at.handStats],
    advance: { next: true },
  },

  // --- Turn 1: red beats green --------------------------------------------------
  {
    id: "t1-battle",
    title: { th: "เทิร์นของคุณ", en: "Your turn" },
    body: {
      th: "กด Go Battle เพื่อเข้าเฟสประลอง",
      en: "Press Go Battle to enter the Battle Phase.",
    },
    highlight: [at.goBattle],
    advance: { move: { kind: "toBattle" } },
  },
  {
    id: "t1-commit",
    title: { th: "คว่ำการ์ดสีแดง", en: "Lay a red card" },
    body: {
      th:
        "เจ้าของเทิร์นคว่ำการ์ดก่อน ลากการ์ดสีแดงไปวางที่พื้นที่แอ็กชัน หรือคลิกการ์ดแล้วเลือก \"ลงคว่ำ\"\n" +
        "อีกฝ่ายจะไม่เห็นว่าคุณลงใบไหน จนกว่าจะเปิดพร้อมกัน",
      en:
        "The turn player lays first. Drag a red card onto your Action Area, or click it and choose \"Commit\".\n" +
        "The other side cannot see which card it is until both are turned up.",
    },
    highlight: [at.hand("red"), at.mySlot],
    advance: { move: { kind: "commit", color: "red" } },
  },
  {
    id: "t1-wait",
    title: { th: "อีกฝ่ายกำลังเลือก…", en: "They are choosing…" },
    body: {
      th: "อีกฝ่ายคว่ำการ์ดตอบ แล้วทั้งสองใบจะเปิดพร้อมกัน",
      en: "The other side lays a card in answer, then both are turned up together.",
    },
    highlight: [at.theirSlot],
    foe: [{ kind: "commit", card: "SD02-020" }],
    advance: { until: revealed },
  },
  {
    id: "t1-result",
    title: { th: "แดงชนะเขียว!", en: "Red beats green!" },
    body: {
      th:
        "อีกฝ่ายลงการ์ดสีเขียว แดงชนะเขียว คุณจึงเป็นผู้ชนะการประลอง\n" +
        "ผู้ชนะทำดาเมจเท่ากับดาเมจของการ์ดที่ชนะ — ใบนี้ดาเมจ 1 อีกฝ่ายเลยเหลือ 19\n" +
        "และเพราะชนะด้วยการ์ดสีแดง คุณได้โจมตีต่อ (follow-up) แบบไม่จำกัดจำนวนในเทิร์นนี้",
      en:
        "They laid a green card. Red beats green, so the clash is yours.\n" +
        "The winner deals the winning card's damage — this one hits for 1, so they drop to 19.\n" +
        "And because you won with a RED card, you may follow up as many times as you like this turn.",
    },
    figure: { kind: "cards", cards: ["SD01-017", "SD02-020"], vs: true },
    highlight: [at.mySlot, at.theirSlot, at.theirLife],
    delayMs: AFTER_REVEAL,
    advance: { next: true },
  },
  {
    id: "t1-combo",
    title: { th: "โจมตีต่อ (Follow-up)", en: "Follow up" },
    body: {
      th:
        "คลิกการ์ดสีแดงในมือเพื่อโจมตีต่อ\n" +
        "follow-up ต้องเป็นการ์ดสีแดงเท่านั้น (และต้องจ่าย cost ของมัน) ไม่ต้องสู้สีกับใคร — ดาเมจเข้าตรง ๆ เลย",
      en:
        "Click a red card in your hand to follow up.\n" +
        "A follow-up is always a red card (and you pay its cost). It does not clash with anything — its damage goes straight through.",
    },
    highlight: [at.hand("red")],
    advance: { move: { kind: "combo", color: "red" } },
  },
  {
    id: "t1-end",
    title: { th: "จบเทิร์น", en: "End the turn" },
    body: {
      th:
        "อีก 1 ดาเมจเข้าไปแล้ว ในเกมจริงถ้ายังมีการ์ดแดงก็ต่อได้เรื่อย ๆ\n" +
        "แต่บทเรียนยังต้องใช้การ์ดที่เหลือ กด End Turn เพื่อจบเทิร์นได้เลย",
      en:
        "Another point of damage in. In a real match you could keep going for as long as you have red cards.\n" +
        "The lesson needs the rest of your hand, though — press End Turn.",
    },
    highlight: [at.endTurn, at.theirLife],
    advance: { move: { kind: "endTurn" } },
  },

  // --- Turn 2: green beats blue, on their turn ---------------------------------
  {
    id: "t2-intro",
    title: { th: "เทิร์นของอีกฝ่าย", en: "Their turn" },
    body: {
      th:
        "ตอนนี้เป็นเทิร์นของอีกฝ่าย เขาจะเข้าเฟสประลองและคว่ำการ์ดก่อน\n" +
        "คุณก็ตอบด้วยการ์ดของคุณได้เหมือนกัน — ฝ่ายที่ไม่ใช่เจ้าของเทิร์นจะเลือกไม่ลงก็ได้ แต่จะแพ้การประลองนั้นไปเลย",
      en:
        "Now it is their turn. They go to battle and lay their card first.\n" +
        "You answer with one of yours. The player whose turn it is NOT may lay nothing at all, but then they simply lose the clash.",
    },
    advance: { next: true },
  },
  {
    id: "t2-wait",
    title: { th: "อีกฝ่ายกำลังเลือก…", en: "They are choosing…" },
    body: { th: "รออีกฝ่ายคว่ำการ์ด", en: "Waiting for them to lay a card." },
    highlight: [at.theirSlot],
    foe: [{ kind: "toBattle" }, { kind: "commit", card: "SD02-008" }],
    advance: { until: theyCommitted },
  },
  {
    id: "t2-commit",
    title: { th: "ตอบด้วยสีที่ชนะ", en: "Answer with the colour that wins" },
    body: {
      th:
        "ปกติคุณจะไม่รู้ว่าอีกฝ่ายคว่ำใบไหน แต่บทเรียนนี้ขอเปิดให้ดู: เป็นการ์ดสีน้ำเงิน ดาเมจ 3\n" +
        "ถ้าตอบด้วยแดง น้ำเงินจะชนะแล้วคุณโดน 3 — สีที่ชนะน้ำเงินคือ เขียว\n" +
        "คว่ำการ์ดสีเขียวลงไป",
      en:
        "Normally you would not know what they laid. For the lesson, here it is: a blue card that hits for 3.\n" +
        "Answer with red and blue wins — you take 3. The colour that beats blue is GREEN.\n" +
        "Lay your green card.",
    },
    figure: { kind: "cards", cards: ["SD02-008"] },
    highlight: [at.hand("green"), at.mySlot],
    advance: { move: { kind: "commit", color: "green" } },
  },
  {
    id: "t2-wait-reveal",
    title: { th: "เปิดการ์ด!", en: "Turning them up!" },
    body: { th: "ทั้งสองฝ่ายเปิดการ์ดพร้อมกัน", en: "Both cards are turned up together." },
    advance: { until: revealed },
  },
  {
    id: "t2-result",
    title: { th: "เขียวชนะน้ำเงิน!", en: "Green beats blue!" },
    body: {
      th:
        "คุณชนะ — แต่การ์ดสีเขียวส่วนใหญ่ดาเมจ 0 การชนะครั้งนี้จึงไม่ทำดาเมจ\n" +
        "จุดเด่นของเขียวอยู่ที่ความสามารถ: ใบนี้ [Judgement] ถ้าชนะ จั่ว 1 ใบ และได้ [Follow 1]\n" +
        "ชนะด้วยสีแดง = follow-up ไม่จำกัด ส่วนชนะด้วยเขียวหรือน้ำเงิน = ได้เท่าที่การ์ดเขียน [Follow X] ไว้เท่านั้น (ไม่มีก็ไม่ได้เลย)",
      en:
        "You win — but most green cards deal 0, so this win does no damage by itself.\n" +
        "Green's strength is its ability: this one's [Judgement] draws a card on a win and grants [Follow 1].\n" +
        "Win with red = unlimited follow-ups. Win with green or blue = only as many as the card's [Follow X] says (none, without one).",
    },
    figure: { kind: "cards", cards: ["SD01-015", "SD02-008"], vs: true },
    highlight: [at.mySlot, at.theirSlot],
    delayMs: AFTER_REVEAL,
    advance: { next: true },
  },
  {
    id: "t2-combo",
    title: { th: "ใช้ Follow-up 1 ครั้ง", en: "Use your one follow-up" },
    body: {
      th:
        "คลิกการ์ดสีแดงในมือเพื่อโจมตีต่อ\n" +
        "ถึงจะเป็นเทิร์นของอีกฝ่าย แต่ผู้ชนะการประลองคือคนที่ได้โจมตีต่อ",
      en:
        "Click a red card in your hand to follow up.\n" +
        "It is their turn, but whoever wins the clash is the one who follows up.",
    },
    highlight: [at.hand("red")],
    advance: { move: { kind: "combo", color: "red" } },
  },
  {
    id: "t2-done",
    title: { th: "ใช้ครบแล้ว", en: "All used up" },
    body: {
      th: "[Follow 1] ใช้ไปแล้ว 1 ครั้ง ไม่มีเหลือ เทิร์นจึงจบไปเอง",
      en: "[Follow 1] gave one follow-up and it is spent, so the turn ends by itself.",
    },
    highlight: [at.theirLife],
    advance: { next: true },
  },

  // --- Turn 3: blue beats red ------------------------------------------------------
  {
    id: "t3-battle",
    title: { th: "เทิร์นของคุณอีกครั้ง", en: "Your turn again" },
    body: {
      th:
        "เมื่อเทิร์นที่แล้วคุณชนะการประลอง เทิร์นนี้คุณจึงได้ Advantage (สัญลักษณ์ ◈Adv ข้างชื่อ) — ความสามารถที่เขียนว่า [Advantage] จะทำงานเฉพาะตอนมีมัน\n" +
        "กด Go Battle",
      en:
        "You won last turn's clash, so this turn you hold Advantage (the ◈Adv beside your name) — abilities marked [Advantage] only work while you have it.\n" +
        "Press Go Battle.",
    },
    highlight: [at.myAdvantage, at.goBattle],
    advance: { move: { kind: "toBattle" } },
  },
  {
    id: "t3-commit",
    title: { th: "ลองลงแดงอีกครั้ง", en: "Red again" },
    body: {
      th: "คว่ำการ์ดสีแดงอีกใบ แล้วดูว่าจะเกิดอะไรขึ้น…",
      en: "Lay another red card, and see what happens…",
    },
    highlight: [at.hand("red"), at.mySlot],
    advance: { move: { kind: "commit", color: "red" } },
  },
  {
    id: "t3-wait",
    title: { th: "อีกฝ่ายกำลังเลือก…", en: "They are choosing…" },
    body: { th: "อีกฝ่ายคว่ำการ์ดตอบ", en: "They lay a card in answer." },
    highlight: [at.theirSlot],
    foe: [{ kind: "commit", card: "SD02-008" }],
    advance: { until: revealed },
  },
  {
    id: "t3-result",
    title: { th: "น้ำเงินชนะแดง", en: "Blue beats red" },
    body: {
      th:
        "อีกฝ่ายอ่านออกว่าคุณจะลงแดง เลยตอบด้วยน้ำเงิน — น้ำเงินชนะแดง คุณโดน 3 ดาเมจ\n" +
        "ใบน้ำเงินนี้ไม่มี [Follow] อีกฝ่ายจึงโจมตีต่อไม่ได้\n" +
        "การประลองคือเกมเดาใจ: คิดว่าอีกฝ่ายจะลงแดง ให้ตอบด้วยน้ำเงิน / คิดว่าจะลงน้ำเงิน ให้ตอบด้วยเขียว / คิดว่าจะลงเขียว ให้ตอบด้วยแดง",
      en:
        "They read the red coming and answered with blue — blue beats red, and you take 3.\n" +
        "Their blue card has no [Follow], so they cannot follow up.\n" +
        "A clash is a guessing game: expect red, answer blue; expect blue, answer green; expect green, answer red.",
    },
    figure: { kind: "cards", cards: ["SD01-012", "SD02-008"], vs: true },
    highlight: [at.theirSlot, at.myLife],
    delayMs: AFTER_REVEAL,
    advance: { next: true },
  },

  // --- Turn 4: same colour, Speed decides ---------------------------------------------
  {
    id: "t4-wait",
    title: { th: "เทิร์นของอีกฝ่าย", en: "Their turn" },
    body: {
      th: "คราวนี้อีกฝ่ายชนะเมื่อเทิร์นที่แล้ว จึงได้ Advantage ไปแทน รออีกฝ่ายคว่ำการ์ด",
      en: "They won the last clash, so now they hold Advantage. Wait for them to lay a card.",
    },
    highlight: [at.theirAdvantage, at.theirSlot],
    foe: [{ kind: "toBattle" }, { kind: "commit", card: "SD02-007" }],
    advance: { until: theyCommitted },
  },
  {
    id: "t4-commit",
    title: { th: "สีเดียวกัน ดูที่ Speed", en: "Same colour? Look at Speed" },
    body: {
      th:
        "เปิดให้ดูอีกครั้ง: อีกฝ่ายลงการ์ดสีแดง Speed 7\n" +
        "ถ้าสีเดียวกัน (แดงกับแดง หรือ เขียวกับเขียว) ฝ่ายที่ Speed สูงกว่าชนะ\n" +
        "การ์ดแดงของคุณ Speed 8 — คว่ำลงไปเลย",
      en:
        "One more peek: they laid a red card with Speed 7.\n" +
        "When the colours match (red and red, or green and green), the higher Speed wins.\n" +
        "Your red cards have Speed 8 — lay one.",
    },
    figure: { kind: "cards", cards: ["SD02-007"] },
    highlight: [at.handStatsOf("red"), at.mySlot],
    advance: { move: { kind: "commit", color: "red" } },
  },
  {
    id: "t4-wait-reveal",
    title: { th: "เปิดการ์ด!", en: "Turning them up!" },
    body: { th: "ทั้งสองฝ่ายเปิดการ์ดพร้อมกัน", en: "Both cards are turned up together." },
    advance: { until: revealed },
  },
  {
    id: "t4-result",
    title: { th: "Speed 8 ชนะ 7!", en: "Speed 8 beats 7!" },
    body: {
      th:
        "แดงเจอแดง Speed ของคุณสูงกว่า คุณชนะและทำดาเมจ 1\n" +
        "ชนะด้วยแดงอีกแล้ว จึงโจมตีต่อได้ไม่จำกัด แม้จะเป็นเทิร์นของอีกฝ่าย — แต่รอบนี้เก็บการ์ดไว้ก่อน กด End Turn",
      en:
        "Red against red, and your Speed is higher: you win and deal 1.\n" +
        "Another red win, so unlimited follow-ups again, even on their turn — but keep your cards this time and press End Turn.",
    },
    highlight: [at.endTurn, at.theirLife],
    delayMs: AFTER_REVEAL,
    advance: { move: { kind: "endTurn" } },
  },

  // --- Turn 5: same colour, same Speed -----------------------------------------------
  {
    id: "t5-battle",
    title: { th: "ถ้า Speed เท่ากันล่ะ?", en: "And if Speed is equal?" },
    body: { th: "เทิร์นของคุณ กด Go Battle", en: "Your turn. Press Go Battle." },
    highlight: [at.goBattle],
    advance: { move: { kind: "toBattle" } },
  },
  {
    id: "t5-commit",
    title: { th: "คว่ำการ์ดสีแดง", en: "Lay a red card" },
    body: {
      th: "คว่ำการ์ดแดง Speed 8 อีกใบ",
      en: "Lay another red card with Speed 8.",
    },
    highlight: [at.hand("red"), at.mySlot],
    advance: { move: { kind: "commit", color: "red" } },
  },
  {
    id: "t5-wait",
    title: { th: "อีกฝ่ายกำลังเลือก…", en: "They are choosing…" },
    body: { th: "อีกฝ่ายคว่ำการ์ดตอบ", en: "They lay a card in answer." },
    highlight: [at.theirSlot],
    foe: [{ kind: "commit", card: "SD02-017" }],
    advance: { until: revealed },
  },
  {
    id: "t5-result",
    title: { th: "เสมอกัน เจ้าของเทิร์นชนะ", en: "A tie goes to the turn player" },
    body: {
      th:
        "อีกฝ่ายลงแดง Speed 8 เท่ากับคุณ — สีเดียวกันและ Speed เท่ากัน ฝ่ายที่เป็นเจ้าของเทิร์นชนะ\n" +
        "นี่คือเทิร์นของคุณ คุณจึงชนะ (ถ้าเป็นเทิร์นของอีกฝ่าย อีกฝ่ายจะชนะ) กด End Turn",
      en:
        "They laid a red Speed 8, the same as yours. Same colour and same Speed: the turn player wins.\n" +
        "It is your turn, so the win is yours (on their turn, it would be theirs). Press End Turn.",
    },
    figure: { kind: "cards", cards: ["SD01-017", "SD02-017"], vs: true },
    highlight: [at.endTurn, at.theirLife],
    delayMs: AFTER_REVEAL,
    advance: { move: { kind: "endTurn" } },
  },

  // --- Turn 6: blue meets blue ------------------------------------------------------------
  {
    id: "t6-wait",
    title: { th: "เทิร์นของอีกฝ่าย", en: "Their turn" },
    body: { th: "รออีกฝ่ายคว่ำการ์ด", en: "Wait for them to lay a card." },
    highlight: [at.theirSlot],
    foe: [{ kind: "toBattle" }, { kind: "commit", card: "SD02-008" }],
    advance: { until: theyCommitted },
  },
  {
    id: "t6-commit",
    title: { th: "น้ำเงินเจอน้ำเงิน", en: "Blue against blue" },
    body: {
      th:
        "อีกฝ่ายลงน้ำเงินอีกแล้ว ปกติควรตอบด้วยเขียว — แต่รอบนี้ลองตอบด้วยน้ำเงินดูว่าเกิดอะไรขึ้น\n" +
        "(Leader ของคุณ Yangyang มีความสามารถเมื่อลงการ์ดน้ำเงิน ถ้ามีคำถามเด้งขึ้นมา ตอบอย่างไรก็ได้)",
      en:
        "Blue again. Green would be the answer — but this time lay blue and see what happens.\n" +
        "(Your Leader, Yangyang, has an ability for blue cards. If it asks you something, answer however you like.)",
    },
    figure: { kind: "cards", cards: ["SD02-008"] },
    highlight: [at.hand("blue"), at.mySlot],
    advance: { move: { kind: "commit", color: "blue" } },
  },
  {
    id: "t6-wait-reveal",
    title: { th: "เปิดการ์ด!", en: "Turning them up!" },
    body: { th: "ทั้งสองฝ่ายเปิดการ์ดพร้อมกัน", en: "Both cards are turned up together." },
    advance: { until: revealed },
  },
  {
    id: "t6-result",
    title: { th: "น้ำเงินกับน้ำเงิน = เสมอ", en: "Blue and blue = a draw" },
    body: {
      th:
        "น้ำเงินเจอน้ำเงินผลคือเสมอทุกครั้ง ไม่ดู Speed (การ์ดน้ำเงินไม่มี Speed)\n" +
        "เสมอแล้ว ไม่มีใครโดนดาเมจ ไม่มีใครได้โจมตีต่อ ไม่มีใครได้ Advantage และเฟสประลองจบทันที",
      en:
        "Blue against blue is always a draw — Speed is never looked at (blue cards have none).\n" +
        "On a draw nobody takes damage, nobody follows up, nobody gains Advantage, and the Battle Phase ends there.",
    },
    figure: { kind: "cards", cards: ["SD01-008", "SD02-008"], vs: true },
    highlight: [at.mySlot, at.theirSlot],
    delayMs: AFTER_REVEAL,
    advance: { next: true },
  },
  {
    id: "summary",
    title: { th: "สรุป", en: "Summary" },
    body: {
      th:
        "อีกสองกรณีที่ควรรู้:\n" +
        "• ถ้าฝ่ายหนึ่งไม่ลงการ์ด อีกฝ่ายชนะทันที (ไม่ลงทั้งคู่ = เสมอ) — เจ้าของเทิร์นต้องลงถ้ามีใบที่ลงได้\n" +
        "• ถ้าเจ้าของเทิร์นข้ามเฟสประลอง อีกฝ่ายจะได้ Advantage ในเทิร์นถัดไป",
      en:
        "Two more cases worth knowing:\n" +
        "• If one side lays nothing, the other wins the clash outright (neither = a draw). The turn player must lay a card if they have one they can play.\n" +
        "• If the turn player skips the Battle Phase, the other side gains Advantage for their next turn.",
    },
    figure: { kind: "summary" },
    advance: { next: true },
  },
];

export const colorLesson: Lesson = {
  id: "colors",
  title: { th: "สีแพ้ชนะ", en: "Colours" },
  blurb: {
    th: "แดง เขียว น้ำเงิน ใครชนะใคร, Speed, เสมอ, ดาเมจ, Follow-up และ Advantage — เล่นจริง 6 เทิร์น",
    en: "Red, green, blue — who beats whom, Speed, draws, damage, follow-ups and Advantage, over 6 real turns",
  },
  setup,
  steps,
};
