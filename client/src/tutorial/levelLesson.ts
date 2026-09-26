// Lesson: Level Up and Switch — the two Main Phase moves that change who is
// on the field.
//
//   turn 1 (you)   Rover (F) Lv.0 → Lv.1: discard 1, and its [Enter] fires
//                  Switch: Yangyang takes the Leader slot
//   turn 3 (you)   Rover (F) Lv.1 → Lv.2: discard 2, and the Lv.1 card's
//                  [Level up] fires from underneath
//   turn 5 (you)   the Lv.2 card's [At start of own turn] draws an extra card
//
// Rulebook 603.1.2 (切换 / 升级): once a turn each; a Level Up names a
// character in play, shows a card of the same character at the same level or
// one higher from the Character Deck, discards cards equal to that card's
// level, and stacks it on top. Then 【登场】 fires on the new top card and
// 【升级】 on the ones beneath it (913.7, 913.8). No battles here — every turn
// skips the Battle Phase, so nothing distracts from the characters.

import type { MatchState } from "@wuwatcg/shared";
import type { GuideStep, Lesson } from "./director";
import { AFTER_LEVEL_UP, SPARRING_FILLER, SPARRING_PARTNER, at, dealLesson, myMainPhase } from "./lessonKit";

/**
 * Rover (F) leads and is the one levelled. Her Level 0 Leader Skill only
 * reacts to a green card laid in battle, and there are no battles here.
 */
function setup(): MatchState {
  return dealLesson(
    "tutorial-level",
    {
      characters: ["Rover (F)", "Yangyang", "Chixia"],
      cards: ["SD01-017", "SD01-012", "SD01-020", "SD01-008", "SD01-013"],
      filler: ["SD01-017", "SD01-013", "SD01-020", "SD01-012", "SD01-018", "SD01-008"],
    },
    {
      characters: SPARRING_PARTNER,
      cards: [],
      filler: SPARRING_FILLER,
    }
  );
}

const skipBattle: GuideStep["advance"] = { move: { kind: "skipCounter" } };

const steps: GuideStep[] = [
  {
    id: "field",
    title: { th: "ตัวละครของคุณ", en: "Your characters" },
    body: {
      th:
        "ตัวละคร 3 ตัวอยู่บนสนาม: Leader ตรงกลาง กับอีก 2 ตัวด้านหลัง ทุกตัวเริ่มที่เลเวล 0\n" +
        "กอง Pool คือการ์ดตัวละครที่เหลือ — เลเวล 1 และ 2 ของทั้งสามตัว รอให้เลเวลอัปขึ้นมา",
      en:
        "Three characters are on the field: the Leader in the middle and two behind. Everyone starts at Level 0.\n" +
        "The Pool holds the rest of your Character Deck — Levels 1 and 2 of all three, waiting to be levelled into.",
    },
    highlight: [at.characters, at.pool],
    advance: { next: true },
  },
  {
    id: "rules",
    title: { th: "เลเวลอัปทำงานอย่างไร", en: "How a Level Up works" },
    body: {
      th: "ทำได้ในเฟส Main เทิร์นละ 1 ครั้ง",
      en: "In the Main Phase, once a turn.",
    },
    figure: {
      kind: "table",
      rows: [
        [
          { th: "เลือก", en: "Pick" },
          { th: "ตัวละครบนสนามตัวไหนก็ได้ (Leader หรือด้านหลัง)", en: "Any character on the field (Leader or back)" },
        ],
        [
          { th: "วางทับ", en: "Stack" },
          { th: "การ์ดตัวเดียวกันจาก Pool เลเวลเท่าเดิมหรือสูงกว่า 1", en: "A card of the same character from the Pool, the same level or one higher" },
        ],
        [
          { th: "จ่าย", en: "Pay" },
          { th: "ทิ้งการ์ดในมือเท่ากับเลเวลของใบใหม่", en: "Discard cards from hand equal to the new card's level" },
        ],
        [
          { th: "ข้ามไม่ได้", en: "No skipping" },
          { th: "0 → 2 ไม่ได้ ต้อง 0 → 1 → 2", en: "0 → 2 is not allowed; it is 0 → 1 → 2" },
        ],
      ],
    },
    highlight: [at.pool],
    advance: { next: true },
  },
  {
    id: "level-1",
    title: { th: "เลเวลอัป Rover (F)", en: "Level up Rover (F)" },
    body: {
      th:
        "คลิก Rover (F) → \"เลเวลอัป\" → เลือก Lv.1 ใบ BP01-017\n" +
        "แล้วเลือกการ์ดในมือ 1 ใบเพื่อทิ้ง (เลเวล 1 = ทิ้ง 1 ใบ) แล้วยืนยัน",
      en:
        "Click Rover (F) → \"Level Up\" → pick the Lv.1 card BP01-017.\n" +
        "Then pick 1 card from your hand to discard (Level 1 = discard 1), and confirm.",
    },
    figure: { kind: "cards", cards: ["BP01-017"] },
    highlight: [at.character("Rover (F)")],
    advance: { move: { kind: "levelUp", card: "BP01-017" } },
  },
  {
    id: "enter",
    title: { th: "[Enter] ทำงาน", en: "[Enter] fires" },
    body: {
      th:
        "การ์ดใบใหม่เพิ่งขึ้นสนาม ความสามารถ [Enter] ของมันจึงทำงาน:\n" +
        "\"เปิดการ์ดใบบนสุดของเด็ค จะนำขึ้นมือก็ได้\" — ตอบคำถามที่เด้งขึ้นมาได้เลย\n" +
        "ใบเดิม (Lv.0) ยังอยู่ข้างใต้ และความสามารถของมันยังทำงานอยู่ — การ์ดที่ถูกทับยังนับว่าอยู่บนสนาม",
      en:
        "The new card has just come onto the field, so its [Enter] ability fires:\n" +
        "\"Reveal the top card of your deck; you may take it to hand\" — answer the question it asks.\n" +
        "The old Lv.0 card is still underneath, and its abilities still work — a covered card is still on the field.",
    },
    highlight: [at.character("Rover (F)")],
    delayMs: AFTER_LEVEL_UP,
    advance: { next: true },
  },
  {
    id: "switch",
    title: { th: "สลับ Leader", en: "Switch" },
    body: {
      th:
        "อีกอย่างที่ทำได้ในเฟส Main เทิร์นละครั้ง: สลับ Leader กับตัวละครด้านหลัง\n" +
        "คลิก Yangyang → \"สลับ\" (หรือลาก Yangyang ไปวางบน Leader)",
      en:
        "The other once-a-turn Main Phase move: swap the Leader with a back character.\n" +
        "Click Yangyang → \"Switch\" (or drag Yangyang onto the Leader).",
    },
    highlight: [at.character("Yangyang"), at.leader],
    advance: { move: { kind: "switch", card: "BP01-024" } },
  },
  {
    id: "leader",
    title: { th: "ทำไม Leader สำคัญ", en: "Why the Leader matters" },
    body: {
      th:
        "• ความสามารถที่มีป้าย [Leader] ทำงานเฉพาะตอนตัวละครนั้นอยู่ช่อง Leader\n" +
        "• การ์ด Action ที่มีป้าย [Leader Skill] ลงได้เฉพาะเมื่อ Leader เป็นตัวละครของการ์ดนั้น\n" +
        "• ความสามารถ [Switch] ทำงานเมื่อตัวละครนั้นถูกสลับ\n" +
        "เลเวลอัปทำกับตัวด้านหลังก็ได้ ไม่ต้องเป็น Leader",
      en:
        "• Abilities marked [Leader] only work while that character sits in the Leader slot.\n" +
        "• Action cards marked [Leader Skill] can only be played while your Leader is that card's character.\n" +
        "• [Switch] abilities fire when that character is switched.\n" +
        "A back character can be levelled up too — it does not need to be the Leader.",
    },
    highlight: [at.leader],
    advance: { next: true },
  },
  {
    id: "skip-1",
    title: { th: "ข้ามการประลองไปก่อน", en: "No battle today" },
    body: {
      th: "บทนี้ไม่ประลอง กด \"ข้ามเฟสประลอง\" เพื่อจบเทิร์น (อีกฝ่ายจะได้ Advantage ในเทิร์นถัดไป)",
      en: "No battles in this lesson: press \"Skip Battle\" to end the turn (the other side gains Advantage next turn).",
    },
    highlight: [at.skipBattle],
    advance: skipBattle,
  },
  {
    id: "their-turn-1",
    title: { th: "เทิร์นของอีกฝ่าย", en: "Their turn" },
    body: { th: "อีกฝ่ายก็ข้ามเหมือนกัน…", en: "They skip it too…" },
    foe: [{ kind: "skipCounter" }],
    advance: { until: myMainPhase },
  },

  // --- Turn 3 -------------------------------------------------------------------------
  {
    id: "level-2",
    title: { th: "ขึ้นเลเวล 2", en: "On to Level 2" },
    body: {
      th:
        "เทิร์นใหม่ เลเวลอัปได้อีกครั้ง: คลิก Rover (F) (ตอนนี้อยู่ด้านหลัง) → \"เลเวลอัป\" → Lv.2 ใบ SD01-001\n" +
        "เลเวล 2 = ทิ้งการ์ดในมือ 2 ใบ",
      en:
        "A new turn, so another Level Up: click Rover (F) (at the back now) → \"Level Up\" → the Lv.2 card SD01-001.\n" +
        "Level 2 = discard 2 cards.",
    },
    figure: { kind: "cards", cards: ["SD01-001"] },
    highlight: [at.character("Rover (F)")],
    advance: { move: { kind: "levelUp", card: "SD01-001" } },
  },
  {
    id: "level-up-fires",
    title: { th: "[Level up] ทำงานจากใบข้างใต้", en: "[Level up] fires from underneath" },
    body: {
      th:
        "ใบ Lv.1 ที่ถูกทับเขียนว่า \"[Enter] / [Level up]\" — [Level up] คือ \"เมื่อการ์ดใบนี้ถูกเลเวลอัปทับ\" จึงทำงานอีกรอบ: เปิดการ์ดบนสุดของเด็ค\n" +
        "สรุป: [Enter] ทำงานกับใบที่เพิ่งขึ้นมา / [Level up] ทำงานกับใบที่ถูกทับ\n" +
        "ส่วนใบ Lv.2 ใหม่เขียนว่า [At start of own turn] จั่ว 1 ใบ — จะเห็นผลเทิร์นหน้า",
      en:
        "The Lv.1 card now underneath reads \"[Enter] / [Level up]\" — [Level up] means \"when this card is levelled up past\", so it fires again: reveal the top card.\n" +
        "In short: [Enter] fires on the card arriving; [Level up] on the card it covers.\n" +
        "The new Lv.2 card reads [At start of own turn] draw 1 — you will see it next turn.",
    },
    highlight: [at.character("Rover (F)")],
    delayMs: AFTER_LEVEL_UP,
    advance: { next: true },
  },
  {
    id: "skip-2",
    title: { th: "จบเทิร์น", en: "End the turn" },
    body: { th: "กด \"ข้ามเฟสประลอง\" อีกครั้ง", en: "Press \"Skip Battle\" again." },
    highlight: [at.skipBattle],
    advance: skipBattle,
  },
  {
    id: "their-turn-2",
    title: { th: "เทิร์นของอีกฝ่าย", en: "Their turn" },
    body: { th: "…", en: "…" },
    foe: [{ kind: "skipCounter" }],
    advance: { until: myMainPhase },
  },
  {
    id: "turn-start",
    title: { th: "[At start of own turn]", en: "[At start of own turn]" },
    body: {
      th: "เทิร์นของคุณเริ่มแล้ว Rover (F) Lv.2 จึงจั่วให้อีก 1 ใบ — เทิร์นนี้ได้ 3 ใบ และทุกเทิร์นของคุณหลังจากนี้ก็เช่นกัน (ดูใน Battle Log ได้)",
      en: "Your turn has begun, so Rover (F) Lv.2 drew you 1 more — 3 cards this turn, and every turn of yours from now on (see the battle log).",
    },
    highlight: [at.character("Rover (F)"), at.anyHand],
    advance: { next: true },
  },
  {
    id: "summary",
    title: { th: "สรุป", en: "Summary" },
    body: {
      th: "ต่อไปลองบท \"ความสามารถการ์ด\" เพื่อดูว่าความสามารถแบบอื่นทำงานตอนไหน",
      en: "Next, try \"Card abilities\" to see when every other kind of ability fires.",
    },
    figure: {
      kind: "table",
      rows: [
        [
          { th: "เลเวลอัป", en: "Level Up" },
          { th: "เทิร์นละครั้ง, เลเวลเท่าเดิมหรือ +1, ทิ้งการ์ดเท่าเลเวลใหม่", en: "Once a turn, same level or +1, discard as many as the new level" },
        ],
        [
          { th: "สลับ", en: "Switch" },
          { th: "เทิร์นละครั้ง, Leader ↔ ตัวด้านหลัง", en: "Once a turn, Leader ↔ a back character" },
        ],
        [
          { th: "[Enter]", en: "[Enter]" },
          { th: "ใบที่เพิ่งขึ้นสนาม", en: "The card arriving" },
        ],
        [
          { th: "[Level up]", en: "[Level up]" },
          { th: "ใบที่ถูกทับ", en: "The card covered" },
        ],
        [
          { th: "[Leader]", en: "[Leader]" },
          { th: "ทำงานเฉพาะในช่อง Leader", en: "Only in the Leader slot" },
        ],
      ],
    },
    advance: { next: true },
  },
];

export const levelLesson: Lesson = {
  id: "level",
  title: { th: "เลเวลอัปและสลับ Leader", en: "Level Up and Switch" },
  blurb: {
    th: "เลเวลอัปตัวละคร 0 → 1 → 2, ทิ้งการ์ดจ่าย, [Enter] / [Level up] และการสลับ Leader",
    en: "Level a character 0 → 1 → 2, pay with discards, [Enter] / [Level up], and switching the Leader",
  },
  setup,
  steps,
};
