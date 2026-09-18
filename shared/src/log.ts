// Everything the battle log says, in one place.
//
// The engine used to build its lines inline, in English, scattered across
// match.ts and effects.ts. Two problems with that: the players read Thai, and
// there was nowhere to go and change the language. So every line the log can
// carry is a function here, and the engine calls it.
//
// The shape is deliberately the smallest thing that solves both: plain
// strings out, one module to open when the app grows a language switch. When
// that day comes, each entry becomes a lookup on the reader's language and
// nothing outside this file has to move.
//
// Two rules for anything added here:
//
//   Seats stay as seats. The engine writes "p1", never a name — a rules
//   function has no business knowing what anybody is called. The client
//   swaps in the real names at the last moment (see withNames in MatchLog).
//
//   Card names stay as printed. They are what is written on the card in the
//   player's hand, and translating them would leave the two disagreeing.

import type { CardColor } from "./game";

const COLOR: Record<CardColor, string> = {
  red: "แดง",
  green: "เขียว",
  blue: "น้ำเงิน",
};

/** "แดง" for a known colour, the raw value for anything else. */
export function colorName(color: CardColor | string): string {
  return COLOR[color as CardColor] ?? color;
}

const SIGN = (amount: number) => (amount >= 0 ? `+${amount}` : `${amount}`);

const DURATION: Record<string, string> = {
  battle: "การปะทะนี้",
  turn: "เทิร์นนี้",
  forever: "ถาวร",
};

const forHowLong = (duration: string) => DURATION[duration] ?? duration;

/**
 * What the engine asks a player, when a card leaves them a choice it cannot
 * make for them.
 *
 * Here for the same reason the log lines are: these are words a player
 * reads, and there should be one place to change them.
 */
export const PROMPT = {
  trashToHand: (count: number) => ({
    th: `เลือกการ์ดจากกองทิ้งขึ้นมือ ${count} ใบ`,
    en: `Take ${count} card(s) from the trash to hand`,
  }),
  trashToConcerto: (count: number) => ({
    th: `เลือกการ์ดจากกองทิ้งไปวางที่ Concerto ${count} ใบ`,
    en: `Move ${count} card(s) from the trash to the Concerto area`,
  }),
  concertoToTrash: (count: number) => ({
    th: `เลือกการ์ดใน Concerto ที่จะทิ้ง ${count} ใบ`,
    en: `Bin ${count} card(s) from the Concerto area`,
  }),
  discard: (count: number) => ({
    th: `เลือกการ์ดในมือที่จะทิ้ง ${count} ใบ`,
    en: `Discard ${count} card(s) from hand`,
  }),
  charge: (count: number) => ({
    th: `เลือกการ์ดในมือไปชาร์จ ${count} ใบ`,
    en: `Charge ${count} card(s) from hand`,
  }),
  searchDeck: (count: number) => ({
    th: `เลือกการ์ดจากเด็ค ${count} ใบ`,
    en: `Take ${count} card(s) from the deck`,
  }),
};

export const LOG = {
  // --- the opening ---
  goesFirst: (player: string) => `สุ่มลำดับแล้ว — ${player} เป็นฝ่ายเริ่มก่อน`,
  mulligans: (player: string, count: number) =>
    `${player} คืนการ์ด ${count} ใบเข้ากอง สับ แล้วจั่วใหม่ ${count} ใบ`,
  keepsHand: (player: string) => `${player} เก็บมือเดิมไว้`,
  mulliganOver: () => "ทั้งสองฝ่ายเลือกมือเริ่มต้นแล้ว — เริ่มเกม",

  // --- the turn ---
  turnStarts: (turn: number, player: string) => `เทิร์น ${turn}: ตาของ ${player}`,
  draws: (player: string, count: number) => `${player} จั่ว ${count} ใบ`,
  deckEmpty: (player: string) => `เด็คของ ${player} หมดแล้ว`,
  recyclesTrash: (player: string, count: number) =>
    `เด็คของ ${player} หมด — นำกองทิ้ง ${count} ใบมาสับเป็นเด็คใหม่`,
  charges: (player: string, inArea: number) =>
    `${player} ชาร์จการ์ด 1 ใบ (Concerto มี ${inArea} ใบ)`,
  discardsToLimit: (player: string, limit: number) => `${player} ทิ้งการ์ดให้เหลือ ${limit} ใบ`,

  // --- characters ---
  levelsUp: (player: string, character: string, level: number) =>
    `${player} เลเวลอัป ${character} เป็น Lv.${level}`,
  switchesLeader: (player: string, character: string) => `${player} สลับ Leader เป็น ${character}`,
  notInPlay: (character: string) => `${character} ไม่ได้อยู่ในสนาม`,
  notInPlayToSwitch: (character: string) => `ไม่มี ${character} ให้สลับไปหา`,
  noLevelUpCardLeft: (character: string) => `ไม่เหลือการ์ดเลเวลอัปของ ${character} แล้ว`,
  noBackCharacter: () => "ไม่มีตัวหลังให้สลับ",
  returnsToCharacterDeck: (card: string) => `${card} กลับเข้า Character Deck`,
  returnsToCharacterDeckExposing: (card: string, beneath: string) =>
    `${card} กลับเข้า Character Deck เผยให้เห็น ${beneath} ที่อยู่ข้างใต้`,
  returnsToCharacterDeckEmptying: (card: string) =>
    `${card} กลับเข้า Character Deck ทำให้ช่องนั้นว่าง`,
  notOnField: (card: string) => `${card} ไม่ได้อยู่ในสนาม — ไม่มีอะไรให้เอากลับ`,

  // --- the clash ---
  battlePhase: (player: string) => `${player} เข้าเฟสประลอง — ลงการ์ดคว่ำได้ทั้งสองฝ่าย`,
  commits: (player: string) => `${player} ลงการ์ดคว่ำ`,
  playsNothing: (player: string) => `${player} ไม่ลงการ์ดในการปะทะนี้`,
  bothReady: () => "ทั้งสองฝ่ายเลือกแล้ว — เปิดการ์ดได้",
  reveals: (player: string, card: string | null) =>
    card ? `${player} เปิด ${card}` : `${player} ไม่ได้ลงการ์ด`,
  winsClash: (player: string, why: string) => `${player} ชนะการปะทะ${why}`,
  byColor: (winner: CardColor, loser: CardColor) =>
    ` (${colorName(winner)}ชนะ${colorName(loser)})`,
  bySpeed: (winner: number, loser: number) => ` (Speed ${winner} ต่อ ${loser})`,
  byTie: () => " (สีและ Speed เท่ากัน — เจ้าของเทิร์นเป็นฝ่ายชนะ)",
  unopposed: () => " (อีกฝ่ายไม่ได้ลงการ์ด)",
  clashDraw: () => "การปะทะเสมอกัน",
  pays: (player: string, cost: number, card: string) => `${player} จ่าย ${cost} เพื่อเล่น ${card}`,
  owes: (player: string, cost: number, card: string, had: number) =>
    `${player} ต้องจ่าย ${cost} ให้ ${card} แต่มีแค่ ${had}`,
  combosInto: (player: string, card: string) => `${player} โจมตีต่อเนื่องด้วย ${card}`,
  endsCombo: (player: string) => `${player} จบการโจมตีต่อเนื่อง`,

  // --- life ---
  takesFrom: (player: string, amount: number, card: string, life: number) =>
    `${player} เสีย ${amount} จาก ${card} (เลือดเหลือ ${life})`,
  healsFrom: (player: string, amount: number, card: string, life: number) =>
    `${player} ฟื้นฟู ${amount} จาก ${card} (เลือดเป็น ${life})`,

  // --- cards moving about ---
  discards: (player: string, count: number) => `${player} ทิ้งการ์ด ${count} ใบ`,
  chargesCards: (player: string, count: number) => `${player} ชาร์จการ์ด ${count} ใบ`,
  revealsTop: (player: string, count: number) => `${player} เปิดการ์ดบนสุดของเด็ค ${count} ใบ`,
  deckToConcerto: (player: string, count: number) =>
    `${player} นำการ์ด ${count} ใบจากเด็คไปวางที่ Concerto`,
  deckToHand: (player: string, count: number) => `${player} นำการ์ด ${count} ใบบนสุดของเด็คขึ้นมือ`,
  deckToTrash: (player: string, count: number) => `${player} ทิ้งการ์ด ${count} ใบบนสุดของเด็ค`,
  trashToHand: (player: string, count: number) =>
    `${player} นำการ์ด ${count} ใบจากกองทิ้งขึ้นมือ`,
  trashToConcerto: (player: string, count: number) =>
    `${player} นำการ์ด ${count} ใบจากกองทิ้งไปวางที่ Concerto`,
  concertoToTrash: (player: string, count: number) =>
    `${player} ทิ้งการ์ด ${count} ใบจาก Concerto`,
  toDeckBottom: (player: string, count: number) =>
    `การ์ด ${count} ใบถูกวางไว้ใต้เด็คของ ${player}`,
  spendsConcerto: (player: string, amount: number) => `${player} ใช้ Concerto ไป ${amount}`,
  searchesDeck: (player: string, found: number) =>
    `${player} ค้นเด็คและนำขึ้นมือ ${found} ใบ`,
  shuffles: (player: string) => `${player} สับเด็ค`,
  revealsHand: (player: string) => `${player} เปิดการ์ดในมือให้ดู`,
  returnsToHand: (card: string) => `${card} กลับขึ้นมือ`,
  notInActionArea: (card: string) => `${card} ไม่ได้อยู่ใน Action Area`,

  // --- modifiers and restrictions ---
  statChange: (what: string, stat: string, amount: number, duration: string) =>
    `${what} ${stat} ${SIGN(amount)} (${forHowLong(duration)})`,
  statSet: (what: string, stat: string, value: number, duration: string) =>
    `${what} ${stat} = ${value} (${forHowLong(duration)})`,
  gainsAbility: (what: string, duration: string) =>
    `${what} ได้รับความสามารถเพิ่ม (${forHowLong(duration)})`,
  damageTakenChange: (player: string, amount: number, duration: string) =>
    `${player} รับดาเมจ ${SIGN(amount)} (${forHowLong(duration)})`,
  gainsFollowUp: (player: string, count: number) =>
    `${player} ได้โจมตีต่อเนื่องเพิ่ม ${count} ครั้ง`,
  restricted: (player: string, flag: string) => `${player} ถูกจำกัดในเทิร์นนี้: ${flag}`,
  restrictedNextTurn: (player: string, flag: string) =>
    `${player} จะถูกจำกัดในเทิร์นหน้า: ${flag}`,

  // --- the match ---
  concedes: (player: string, winner: string | null) =>
    winner ? `${player} ยอมแพ้ — ${winner} ชนะ` : `${player} ยอมแพ้`,
  wins: (player: string) => `${player} ชนะ`,
  matchDraw: () => "เกมนี้เสมอกัน",
  leftMatch: (player: string, winner: string | null) =>
    winner ? `${player} ออกจากเกม — ${winner} ชนะ` : `${player} ออกจากเกม`,
};
