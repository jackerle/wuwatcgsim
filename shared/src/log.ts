// Everything the battle log says, in one place.
//
// Every line is written once, in both languages at once, and read back
// through the reader's own — see localize() in cards.ts. The two rules from
// before still hold:
//
//   Seats stay as seats. The engine writes "p1", never a name — a rules
//   function has no business knowing what anybody is called. The client
//   swaps in the real names at the last moment (see withNames in MatchLog),
//   working the same substitution against whichever language it displays.
//
//   Card names stay as printed. They are what is written on the card in the
//   player's hand, and translating them would leave the two disagreeing.

import type { CardColor } from "./game";
import type { Lang } from "./cards";

/** One log line, always filled in both languages — never partial like a
 *  LocalizedText from card data can be. */
export type LogLine = { th: string; en: string };

const COLOR: Record<Lang, Record<CardColor, string>> = {
  th: { red: "แดง", green: "เขียว", blue: "น้ำเงิน" },
  en: { red: "red", green: "green", blue: "blue" },
};

/** "แดง"/"red" for a known colour, the raw value for anything else. */
export function colorName(color: CardColor | string, lang: Lang = "th"): string {
  return COLOR[lang][color as CardColor] ?? color;
}

const SIGN = (amount: number) => (amount >= 0 ? `+${amount}` : `${amount}`);

const DURATION: Record<Lang, Record<string, string>> = {
  th: { battle: "การปะทะนี้", turn: "เทิร์นนี้", forever: "ถาวร" },
  en: { battle: "this clash", turn: "this turn", forever: "permanently" },
};

const forHowLong = (duration: string, lang: Lang) => DURATION[lang][duration] ?? duration;

/**
 * Some LOG templates take a "what did this" slot that is sometimes a card
 * ("Camellya [BP01-001]", the same in both languages) and sometimes a
 * phrase that itself needs translating ("the clash", when no single card
 * gets the credit). A plain string skips translation — right for a card
 * name — and a LogLine picks per language, so one signature covers both.
 */
function resolveSource(source: string | LogLine, lang: Lang): string {
  return typeof source === "string" ? source : source[lang];
}

/** Builds one LogLine by running a template in both languages at once. */
function line(th: string, en: string): LogLine {
  return { th, en };
}

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
  goesFirst: (player: string) =>
    line(`สุ่มลำดับแล้ว — ${player} เป็นฝ่ายเริ่มก่อน`, `Coin flipped — ${player} goes first`),
  mulligans: (player: string, count: number) =>
    line(
      `${player} คืนการ์ด ${count} ใบเข้ากอง สับ แล้วจั่วใหม่ ${count} ใบ`,
      `${player} returns ${count} card(s) to the deck, shuffles, and draws ${count} new one(s)`
    ),
  keepsHand: (player: string) => line(`${player} เก็บมือเดิมไว้`, `${player} keeps their hand`),
  mulliganOver: () =>
    line("ทั้งสองฝ่ายเลือกมือเริ่มต้นแล้ว — เริ่มเกม", "Both sides have their opening hand — the match begins"),

  // --- the turn ---
  turnStarts: (turn: number, player: string) => line(`เทิร์น ${turn}: ตาของ ${player}`, `Turn ${turn}: ${player}'s turn`),
  draws: (player: string, count: number) => line(`${player} จั่ว ${count} ใบ`, `${player} draws ${count} card(s)`),
  deckEmpty: (player: string) => line(`เด็คของ ${player} หมดแล้ว`, `${player}'s deck is empty`),
  recyclesTrash: (player: string, count: number) =>
    line(
      `เด็คของ ${player} หมด — นำกองทิ้ง ${count} ใบมาสับเป็นเด็คใหม่`,
      `${player}'s deck ran out — their ${count}-card trash is shuffled into a new deck`
    ),
  charges: (player: string, inArea: number) =>
    line(
      `${player} ชาร์จการ์ด 1 ใบ (Concerto มี ${inArea} ใบ)`,
      `${player} charges 1 card (Concerto has ${inArea})`
    ),
  discardsToLimit: (player: string, limit: number) =>
    line(`${player} ทิ้งการ์ดให้เหลือ ${limit} ใบ`, `${player} discards down to ${limit} card(s)`),

  // --- characters ---
  levelsUp: (player: string, character: string, level: number) =>
    line(`${player} เลเวลอัป ${character} เป็น Lv.${level}`, `${player} levels up ${character} to Lv.${level}`),
  switchesLeader: (player: string, character: string) =>
    line(`${player} สลับ Leader เป็น ${character}`, `${player} switches Leader to ${character}`),
  notInPlay: (character: string) => line(`${character} ไม่ได้อยู่ในสนาม`, `${character} is not in play`),
  notInPlayToSwitch: (character: string) =>
    line(`ไม่มี ${character} ให้สลับไปหา`, `There's no ${character} to switch to`),
  noLevelUpCardLeft: (character: string) =>
    line(`ไม่เหลือการ์ดเลเวลอัปของ ${character} แล้ว`, `No Level Up cards left for ${character}`),
  noBackCharacter: () => line("ไม่มีตัวหลังให้สลับ", "No back character to switch to"),
  returnsToCharacterDeck: (card: string) => line(`${card} กลับเข้า Character Deck`, `${card} returns to the Character deck`),
  returnsToCharacterDeckExposing: (card: string, beneath: string) =>
    line(
      `${card} กลับเข้า Character Deck เผยให้เห็น ${beneath} ที่อยู่ข้างใต้`,
      `${card} returns to the Character deck, exposing ${beneath} underneath`
    ),
  returnsToCharacterDeckEmptying: (card: string) =>
    line(
      `${card} กลับเข้า Character Deck ทำให้ช่องนั้นว่าง`,
      `${card} returns to the Character deck, leaving that slot empty`
    ),
  notOnField: (card: string) => line(`${card} ไม่ได้อยู่ในสนาม — ไม่มีอะไรให้เอากลับ`, `${card} is not on the field — nothing to return`),

  // --- the clash ---
  battlePhase: (player: string) =>
    line(`${player} เข้าเฟสประลอง — ลงการ์ดคว่ำได้ทั้งสองฝ่าย`, `${player} opens the Battle Phase — both sides may commit a card`),
  commits: (player: string) => line(`${player} ลงการ์ดคว่ำ`, `${player} commits a card face-down`),
  playsNothing: (player: string) => line(`${player} ไม่ลงการ์ดในการปะทะนี้`, `${player} passes on this clash`),
  bothReady: () => line("ทั้งสองฝ่ายเลือกแล้ว — เปิดการ์ดได้", "Both sides are ready — cards are revealed"),
  reveals: (player: string, card: string | null) =>
    card ? line(`${player} เปิด ${card}`, `${player} reveals ${card}`) : line(`${player} ไม่ได้ลงการ์ด`, `${player} committed nothing`),
  winsClash: (player: string, why: LogLine) =>
    line(`${player} ชนะการปะทะ${why.th}`, `${player} wins the clash${why.en}`),
  byColor: (winner: CardColor, loser: CardColor) =>
    line(
      ` (${colorName(winner, "th")}ชนะ${colorName(loser, "th")})`,
      ` (${colorName(winner, "en")} beats ${colorName(loser, "en")})`
    ),
  bySpeed: (winner: number, loser: number) => line(` (Speed ${winner} ต่อ ${loser})`, ` (Speed ${winner} vs ${loser})`),
  byTie: () =>
    line(" (สีและ Speed เท่ากัน — เจ้าของเทิร์นเป็นฝ่ายชนะ)", " (same colour and Speed — the turn player wins)"),
  unopposed: () => line(" (อีกฝ่ายไม่ได้ลงการ์ด)", " (the other side committed nothing)"),
  clashDraw: () => line("การปะทะเสมอกัน", "The clash is a draw"),
  pays: (player: string, cost: number, card: string) => line(`${player} จ่าย ${cost} เพื่อเล่น ${card}`, `${player} pays ${cost} to play ${card}`),
  owes: (player: string, cost: number, card: string, had: number) =>
    line(`${player} ต้องจ่าย ${cost} ให้ ${card} แต่มีแค่ ${had}`, `${player} owes ${cost} for ${card} but only has ${had}`),
  combosInto: (player: string, card: string) => line(`${player} โจมตีต่อเนื่องด้วย ${card}`, `${player} combos with ${card}`),
  endsCombo: (player: string) => line(`${player} จบการโจมตีต่อเนื่อง`, `${player} ends the combo`),

  // --- life ---
  takesFrom: (player: string, amount: number, source: string | LogLine, life: number) =>
    line(
      `${player} เสีย ${amount} จาก ${resolveSource(source, "th")} (เลือดเหลือ ${life})`,
      `${player} takes ${amount} from ${resolveSource(source, "en")} (${life} life left)`
    ),
  healsFrom: (player: string, amount: number, source: string | LogLine, life: number) =>
    line(
      `${player} ฟื้นฟู ${amount} จาก ${resolveSource(source, "th")} (เลือดเป็น ${life})`,
      `${player} heals ${amount} from ${resolveSource(source, "en")} (${life} life now)`
    ),

  // --- cards moving about ---
  discards: (player: string, count: number) => line(`${player} ทิ้งการ์ด ${count} ใบ`, `${player} discards ${count} card(s)`),
  chargesCards: (player: string, count: number) => line(`${player} ชาร์จการ์ด ${count} ใบ`, `${player} charges ${count} card(s)`),
  revealsTop: (player: string, count: number) =>
    line(`${player} เปิดการ์ดบนสุดของเด็ค ${count} ใบ`, `${player} reveals the top ${count} card(s) of their deck`),
  deckToConcerto: (player: string, count: number) =>
    line(`${player} นำการ์ด ${count} ใบจากเด็คไปวางที่ Concerto`, `${player} puts ${count} card(s) from their deck into the Concerto area`),
  deckToHand: (player: string, count: number) =>
    line(`${player} นำการ์ด ${count} ใบบนสุดของเด็คขึ้นมือ`, `${player} takes the top ${count} card(s) of their deck to hand`),
  deckToTrash: (player: string, count: number) =>
    line(`${player} ทิ้งการ์ด ${count} ใบบนสุดของเด็ค`, `${player} discards the top ${count} card(s) of their deck`),
  trashToHand: (player: string, count: number) =>
    line(`${player} นำการ์ด ${count} ใบจากกองทิ้งขึ้นมือ`, `${player} takes ${count} card(s) from the trash to hand`),
  trashToConcerto: (player: string, count: number) =>
    line(`${player} นำการ์ด ${count} ใบจากกองทิ้งไปวางที่ Concerto`, `${player} puts ${count} card(s) from the trash into the Concerto area`),
  concertoToTrash: (player: string, count: number) =>
    line(`${player} ทิ้งการ์ด ${count} ใบจาก Concerto`, `${player} discards ${count} card(s) from the Concerto area`),
  toDeckBottom: (player: string, count: number) =>
    line(`การ์ด ${count} ใบถูกวางไว้ใต้เด็คของ ${player}`, `${count} card(s) are put on the bottom of ${player}'s deck`),
  spendsConcerto: (player: string, amount: number) => line(`${player} ใช้ Concerto ไป ${amount}`, `${player} spends ${amount} Concerto`),
  searchesDeck: (player: string, found: number) =>
    line(`${player} ค้นเด็คและนำขึ้นมือ ${found} ใบ`, `${player} searches their deck and takes ${found} card(s) to hand`),
  shuffles: (player: string) => line(`${player} สับเด็ค`, `${player} shuffles their deck`),
  revealsHand: (player: string) => line(`${player} เปิดการ์ดในมือให้ดู`, `${player} reveals their hand`),
  returnsToHand: (card: string) => line(`${card} กลับขึ้นมือ`, `${card} returns to hand`),
  notInActionArea: (card: string) => line(`${card} ไม่ได้อยู่ใน Action Area`, `${card} is not in the Action Area`),

  // --- modifiers and restrictions ---
  statChange: (what: string, stat: string, amount: number, duration: string) =>
    line(
      `${what} ${stat} ${SIGN(amount)} (${forHowLong(duration, "th")})`,
      `${what} ${stat} ${SIGN(amount)} (${forHowLong(duration, "en")})`
    ),
  statSet: (what: string, stat: string, value: number, duration: string) =>
    line(
      `${what} ${stat} = ${value} (${forHowLong(duration, "th")})`,
      `${what} ${stat} = ${value} (${forHowLong(duration, "en")})`
    ),
  gainsAbility: (what: string, duration: string) =>
    line(
      `${what} ได้รับความสามารถเพิ่ม (${forHowLong(duration, "th")})`,
      `${what} gains an ability (${forHowLong(duration, "en")})`
    ),
  damageTakenChange: (player: string, amount: number, duration: string) =>
    line(
      `${player} รับดาเมจ ${SIGN(amount)} (${forHowLong(duration, "th")})`,
      `${player} damage taken ${SIGN(amount)} (${forHowLong(duration, "en")})`
    ),
  gainsFollowUp: (player: string, count: number) =>
    line(`${player} ได้โจมตีต่อเนื่องเพิ่ม ${count} ครั้ง`, `${player} gains ${count} more follow-up attack(s)`),
  restricted: (player: string, flag: string) => line(`${player} ถูกจำกัดในเทิร์นนี้: ${flag}`, `${player} is restricted this turn: ${flag}`),
  restrictedNextTurn: (player: string, flag: string) =>
    line(`${player} จะถูกจำกัดในเทิร์นหน้า: ${flag}`, `${player} will be restricted next turn: ${flag}`),

  // --- the match ---
  concedes: (player: string, winner: string | null) =>
    winner
      ? line(`${player} ยอมแพ้ — ${winner} ชนะ`, `${player} concedes — ${winner} wins`)
      : line(`${player} ยอมแพ้`, `${player} concedes`),
  wins: (player: string) => line(`${player} ชนะ`, `${player} wins`),
  matchDraw: () => line("เกมนี้เสมอกัน", "The match is a draw"),
  leftMatch: (player: string, winner: string | null) =>
    winner
      ? line(`${player} ออกจากเกม — ${winner} ชนะ`, `${player} left the match — ${winner} wins`)
      : line(`${player} ออกจากเกม`, `${player} left the match`),
};
