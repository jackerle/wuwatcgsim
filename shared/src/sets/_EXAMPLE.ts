// Reference file — not a real set, never listed in index.ts. Copy the shape
// of these entries when filling in BP01.ts / SD01.ts / SD02.ts.
//
// The first card is a real one (BP01-001 Camellya Lv.2) written out in full,
// so you can see how a printed ability turns into a condition + text +
// resolve. The rest show the patterns you will keep needing.
//
// `text` and `notes` take either language, or both. A missing one falls back
// to whichever is filled in, so a half-translated card still reads.

import { defineCard } from "../cardDef";
import type { CardDef } from "../cardDef";

export const EXAMPLE: CardDef[] = [
  defineCard({
    type: "leader",
    id: "BP01-001",
    name: "Camellya",
    character: "Camellya",
    set: "BP01",
    imageId: "BP01-001",
    altImageIds: ["BP01-001_4", "BP01-001_5"],
    level: 2,
    rarity: 3,
    element: "havoc",
    weapon: "sword",
    effects: [
      {
        condition: ["levelUp"],
        text: {
          en: "Return this card to the Character deck",
          th: "นำการ์ดใบนี้กลับเข้า Character deck",
        },
        resolve: (ctx) => ctx.returnToCharacterDeck(),
      },
      {
        condition: ["leader"],
        text: {
          en: "Damage its owner takes +1. 「Camellya」red cards get +1 damage.",
          th: "ดาเมจที่เจ้าของได้รับ +1 การ์ดสีแดงของ「Camellya」ได้รับ +1 ดาเมจ",
        },
        resolve: (ctx) => {
          // Two clauses on one printed line, so two calls here.
          ctx.modifyDamageTaken(+1);
          ctx.buff({ character: "Camellya", color: "red" }, "attack", +1);
        },
      },
    ],
  }),

  defineCard({
    type: "action",
    id: "XX00-001",
    name: "ตัวอย่าง action ที่มีเงื่อนไขเพิ่ม",
    character: null,
    set: "BP01",
    imageId: "XX00-001",
    cost: 2,
    color: "green",
    speed: 13,
    attack: 5,
    effects: [
      {
        // Keywords and custom checks mix freely. Everything here must hold.
        condition: ["judgement", "advantage"],
        text: { th: "เมื่อตัดสินผล ถ้าชนะ battle รอบล่าสุด ทำดาเมจ 3" },
        resolve: (ctx) => ctx.damage(3),
      },
      {
        // A check the keywords cannot express — just write it.
        condition: ["enter", (ctx) => ctx.hand().length >= 5],
        text: { th: "เมื่อลงสนาม ถ้ามีการ์ดในมือ 5 ใบขึ้นไป จั่ว 2 ใบ" },
        resolve: (ctx) => ctx.draw(2),
      },
      {
        // Follow{x}: grants follow-up attacks when this card wins.
        condition: ["follow"],
        followCount: 2,
        text: { th: "Follow{2} — ชนะแล้วต่อคอมโบได้ 2 ครั้ง" },
      },
      {
        // No resolve yet: the engine shows this text and asks the players to
        // apply it themselves. Perfectly fine to leave like this.
        condition: ["endTurn"],
        text: { th: "เอฟเฟคที่ยังไม่ได้เขียนโค้ด ระบบจะขึ้นข้อความนี้ให้ผู้เล่นทำเอง" },
        tags: ["ยังไม่ทำ"],
      },
    ],
  }),

  defineCard({
    // A card with nothing printed but its stats. Perfectly normal.
    type: "action",
    id: "XX00-002",
    name: "การ์ดที่มีแค่ค่าพลัง",
    character: null,
    set: "BP01",
    imageId: "XX00-002",
    cost: 1,
    color: "blue",
    // Blue prints no Speed — blue always draws against blue, and every other
    // match-up is settled by colour alone.
    speed: null,
    attack: 6,
    effects: [],
  }),
];
