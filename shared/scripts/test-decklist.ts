// Deck building: what a deck may hold, and the text format it travels in.
//
// The engine only ever sees two flat arrays, so everything that decides what
// is legal lives in deckList.ts and is checked here — including the import
// parser, which has to survive whatever a list looks like after a trip
// through a chat window.
//
// Run with: npm run test:decklist

import { ALL_CARDS, getCard } from "../src/cardDb";
import {
  MAX_COPIES_PER_CARD,
  cardPoolFor,
  characterCardsFor,
  deckIssues,
  deckSize,
  deckToSetup,
  emptyDeck,
  formatDeck,
  isDeckPlayable,
  neutralActionCards,
  parseDeck,
  type DeckList,
} from "../src/deckList";
import { playableCharacters } from "../src/decks";
import {
  isStarterDeckId,
  starterDeckParseErrors,
  starterDecks,
} from "../src/starterDecks";
import { CHARACTERS_IN_PLAY } from "../src/game";
import { ACTION_DECK_SIZE, CHARACTER_DECK_MAX, validateDecks } from "../src/rules";

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  [${detail}]` : ""}`);
  ok ? (pass += 1) : (fail += 1);
};

const NAMES = playableCharacters();
const ROSTER = NAMES.slice(0, CHARACTERS_IN_PLAY);

/** A legal deck: fill up to 40 from the pool, at most 4 of anything. */
function fullDeck(characters = ROSTER, name = "Test"): DeckList {
  const deck = emptyDeck("test", name);
  deck.characters = [...characters];
  const pool = cardPoolFor(characters);
  let i = 0;
  while (deckSize(deck) < ACTION_DECK_SIZE) {
    const card = pool[i % pool.length];
    const have = deck.cards[card.id] ?? 0;
    if (have < MAX_COPIES_PER_CARD) deck.cards[card.id] = have + 1;
    i += 1;
    if (i > pool.length * MAX_COPIES_PER_CARD) throw new Error("pool too small to fill a deck");
  }
  return deck;
}

// --- The pool --------------------------------------------------------------

{
  check("มีตัวละครให้เลือกอย่างน้อย 3 ตัว", NAMES.length >= CHARACTERS_IN_PLAY, `${NAMES.length}`);

  const neutral = neutralActionCards();
  check("มีการ์ด Echo กลางที่ทุกเด็คใช้ได้", neutral.length > 0, `${neutral.length} ใบ`);
  check(
    "การ์ดกลางไม่ผูกกับตัวละครใด",
    neutral.every((card) => !card.character)
  );

  const pool = cardPoolFor(ROSTER);
  const own = pool.filter((card) => card.character);
  check(
    "พูลคือการ์ดของสามตัวละคร + การ์ดกลาง",
    own.every((card) => ROSTER.includes(card.character!)) && pool.length === own.length + neutral.length,
    `${pool.length} ใบ`
  );
  check(
    "การ์ดของตัวละครอื่นไม่อยู่ในพูล",
    !pool.some((card) => card.character && !ROSTER.includes(card.character))
  );
  check(
    "พูลใหญ่พอจะทำเด็ค 40 ใบได้",
    pool.length * MAX_COPIES_PER_CARD >= ACTION_DECK_SIZE,
    `${pool.length} x ${MAX_COPIES_PER_CARD}`
  );
}

// --- The Character Deck is not a choice ------------------------------------

{
  const characters = characterCardsFor(ROSTER);
  check(
    "เลือก 3 ตัวละคร -> ได้การ์ดตัวละครครบ 15 ใบ",
    characters.length === CHARACTER_DECK_MAX,
    `${characters.length}`
  );
  check(
    "ทุกตัวละครมีการ์ด Lv.0 ไว้เริ่มเกม",
    ROSTER.every((name) =>
      characters.some((card) => card.character === name && card.type === "leader" && card.level === 0)
    )
  );
}

// --- Legality --------------------------------------------------------------

{
  const deck = fullDeck();
  check("เด็คที่ครบถ้วนผ่านการตรวจ", isDeckPlayable(deck), deckIssues(deck).join("; "));

  const short = { ...deck, cards: { ...deck.cards } };
  const first = Object.keys(short.cards)[0];
  short.cards[first] -= 1;
  check("การ์ดไม่ครบ 40 -> ไม่ผ่าน", !isDeckPlayable(short), deckIssues(short).join("; "));
  check(
    "และบอกว่าขาดไปเท่าไหร่",
    deckIssues(short).some((issue) => issue.includes(String(ACTION_DECK_SIZE)))
  );

  const twoChars = { ...deck, characters: ROSTER.slice(0, 2) };
  check("เลือกตัวละครไม่ครบ 3 -> ไม่ผ่าน", !isDeckPlayable(twoChars));

  const dupes = { ...deck, characters: [ROSTER[0], ROSTER[0], ROSTER[1]] };
  check(
    "เลือกตัวละครซ้ำ -> ไม่ผ่าน",
    deckIssues(dupes).some((issue) => issue.includes("ซ้ำ"))
  );

  const tooMany = { ...deck, cards: { ...deck.cards, [first]: MAX_COPIES_PER_CARD + 1 } };
  check(
    `เกิน ${MAX_COPIES_PER_CARD} ใบต่อการ์ด -> ไม่ผ่าน`,
    deckIssues(tooMany).some((issue) => issue.includes(String(MAX_COPIES_PER_CARD)))
  );

  // A card belonging to a character who isn't on the roster.
  const outsider = ALL_CARDS.find(
    (card) => card.type === "action" && card.character && !ROSTER.includes(card.character)
  );
  if (outsider) {
    const wrong = { ...deck, cards: { ...deck.cards, [outsider.id]: 1 } };
    check(
      "ใส่การ์ดของตัวละครที่ไม่ได้เลือก -> ไม่ผ่าน",
      deckIssues(wrong).some((issue) => issue.includes(outsider.id)),
      deckIssues(wrong).join("; ")
    );
  }
}

// --- Handing it to the engine ----------------------------------------------

{
  const deck = fullDeck();
  const setup = deckToSetup(deck);
  check(
    "แปลงเป็นสำรับจริง: Action Deck 40 ใบ",
    setup.actionDeck.length === ACTION_DECK_SIZE,
    `${setup.actionDeck.length}`
  );
  check(
    "แปลงเป็นสำรับจริง: Character Deck 15 ใบ",
    setup.characterDeck.length === CHARACTER_DECK_MAX,
    `${setup.characterDeck.length}`
  );
  check(
    "สำรับที่ได้ผ่าน validateDecks ของเอนจิน",
    validateDecks(setup.characterDeck, setup.actionDeck).length === 0,
    validateDecks(setup.characterDeck, setup.actionDeck)
      .map((issue) => issue.message)
      .join("; ")
  );
  check(
    "จำนวนสำเนาตรงกับที่สั่งไว้",
    Object.entries(deck.cards).every(
      ([id, copies]) => setup.actionDeck.filter((card) => card.id === id).length === copies
    )
  );

  // An illegal deck must not quietly deal — it throws.
  const broken = emptyDeck("broken", "Broken");
  let threw = false;
  try {
    deckToSetup(broken);
  } catch {
    threw = true;
  }
  check("เด็คที่ไม่ถูกกติกาแจกไม่ได้ (throw)", threw);
}

// --- Text format -----------------------------------------------------------

{
  const deck = fullDeck(ROSTER, "เด็คของฉัน");
  const text = formatDeck(deck);
  check("export ออกมาเป็นรูปแบบ IDxN", /^[A-Z]{2}\d{2}-\d{3}x\d+$/m.test(text), text.split("\n")[3] ?? "");

  const { deck: back, errors } = parseDeck(text, "copy", "ไม่มีชื่อ");
  check("import กลับเข้ามาได้ไม่มี error", errors.length === 0, errors.join("; "));
  check("ชื่อเด็คติดกลับมาด้วย", back.name === "เด็คของฉัน", back.name);
  check(
    "ตัวละครสามตัวเดิม",
    back.characters.slice().sort().join(",") === deck.characters.slice().sort().join(","),
    back.characters.join(",")
  );
  // Compared by content, not by key order: export sorts by card id, so the
  // object that comes back is the same deck written down differently.
  const sameCards = (a: DeckList, b: DeckList) => {
    const ids = new Set([...Object.keys(a.cards), ...Object.keys(b.cards)]);
    return [...ids].every((id) => (a.cards[id] ?? 0) === (b.cards[id] ?? 0));
  };
  check(
    "การ์ดและจำนวนสำเนาเหมือนเดิมทุกใบ",
    sameCards(back, deck),
    `${deckSize(back)} vs ${deckSize(deck)}`
  );
  check("เด็คที่ import กลับมายังเล่นได้", isDeckPlayable(back), deckIssues(back).join("; "));
}

// รูปแบบที่คนพิมพ์มาเองแบบต่างๆ
{
  const sample = ALL_CARDS.find((card) => card.type === "action" && card.character)!;
  const other = ALL_CARDS.find(
    (card) => card.type === "action" && card.character === sample.character && card.id !== sample.id
  )!;

  const messy = [
    "# รายการของฉัน",
    "",
    `${sample.id}x3`,
    `${other.id} x 2`,
    `${sample.id.toLowerCase()}x1`,
    "",
    "// comment",
  ].join("\n");
  const { deck, errors } = parseDeck(messy, "m", "ไม่มีชื่อ");
  check("อ่านรูปแบบที่เขียนต่างกันได้", errors.length === 0, errors.join("; "));
  check("ตัวพิมพ์เล็กก็อ่านได้ และรวมจำนวนให้", deck.cards[sample.id] === 4, `${deck.cards[sample.id]}`);
  check("เว้นวรรครอบ x ก็อ่านได้", deck.cards[other.id] === 2, `${deck.cards[other.id]}`);
  check("บรรทัดคอมเมนต์แรกกลายเป็นชื่อเด็ค", deck.name === "รายการของฉัน", deck.name);
  check(
    "เดาตัวละครจากการ์ดที่ใส่มาได้",
    deck.characters.includes(sample.character!),
    deck.characters.join(",")
  );
}

// บรรทัดที่ผิดต้องฟ้อง ไม่ใช่เงียบหาย
{
  const { deck, errors } = parseDeck("ZZ99-999x1\nอะไรก็ไม่รู้\nBP01-044x2", "e", "x");
  check("รหัสการ์ดที่ไม่มีจริง -> ฟ้อง", errors.some((e) => e.includes("ZZ99-999")), errors.join("; "));
  check("บรรทัดที่อ่านไม่ออก -> ฟ้อง", errors.some((e) => e.includes("อ่านไม่ออก")), errors.join("; "));
  check("แต่บรรทัดที่ถูกยังเข้าเด็คตามปกติ", deck.cards["BP01-044"] === 2, `${deck.cards["BP01-044"]}`);
}

// เขียนเฉพาะรหัสเปล่าๆ = 1 ใบ
{
  const { deck, errors } = parseDeck("BP01-044\nBP01-044", "b", "x");
  check("รหัสเปล่าไม่ใส่ xN นับเป็น 1 ใบ", deck.cards["BP01-044"] === 2 && errors.length === 0);
}

// เด็คว่างเปล่า export แล้ว import กลับได้ ไม่พัง
{
  const empty = emptyDeck("e", "ว่าง");
  const { deck, errors } = parseDeck(formatDeck(empty), "e2", "x");
  check(
    "เด็คว่าง export/import ไม่พัง",
    errors.length === 0 && deckSize(deck) === 0 && deck.characters.length === 0
  );
}

// การ์ดตัวละครในไฟล์บอกว่าเด็คนี้ของใคร
{
  const lv0 = ALL_CARDS.filter((card) => card.type === "leader" && card.level === 0).slice(0, 3);
  const text = lv0.map((card) => `${card.id}x1`).join("\n");
  const { deck } = parseDeck(text, "r", "x");
  check(
    "การ์ดตัวละครในลิสต์กำหนดทีมสามตัว",
    deck.characters.length === 3 &&
      lv0.every((card) => deck.characters.includes(card.character!)),
    deck.characters.join(",")
  );
  check("การ์ดตัวละครไม่ถูกนับเป็นการ์ดใน Action Deck", deckSize(deck) === 0);
}

// ทุกตัวละครที่เลือกได้ ต้องประกอบเด็คที่เล่นได้จริง
{
  let bad = 0;
  for (let i = 0; i + CHARACTERS_IN_PLAY <= NAMES.length; i += 1) {
    const roster = NAMES.slice(i, i + CHARACTERS_IN_PLAY);
    const deck = fullDeck(roster, roster.join("/"));
    if (!isDeckPlayable(deck)) {
      bad += 1;
      console.log("   ", roster.join(","), deckIssues(deck).join("; "));
    }
    // And it has to survive the trip through the engine's own check.
    const setup = deckToSetup(deck);
    if (validateDecks(setup.characterDeck, setup.actionDeck).length > 0) bad += 1;
  }
  check("ทุกชุดตัวละครประกอบเด็คที่ถูกกติกาได้", bad === 0, `${bad} ชุดมีปัญหา`);
}

// getCard ต้องรู้จักทุกใบในพูล มิฉะนั้น builder จะแสดงการ์ดที่ไม่มีอยู่จริง
{
  const pool = cardPoolFor(ROSTER);
  check(
    "ทุกใบในพูลค้นเจอใน card database",
    pool.every((card) => getCard(card.id)?.id === card.id)
  );
}

// เด็คตั้งต้นที่ติดมากับแอป
//
// These are the only decks a first-time player has, so a typo in one of their
// card ids is a deck that cannot be played at all — and the ids are hand-kept
// text. This is the check that catches it at build time rather than in a lobby.
{
  const errors = starterDeckParseErrors();
  check(
    "เด็คตั้งต้นทุกใบ: parse ไม่มี error",
    errors.length === 0,
    JSON.stringify(errors)
  );

  const decks = starterDecks();
  check("มีเด็คตั้งต้นอยู่จริง", decks.length > 0, `${decks.length} เด็ค`);
  check(
    "id ทุกใบขึ้นต้นด้วย starter- และไม่ซ้ำกัน",
    decks.every((deck) => isStarterDeckId(deck.id)) &&
      new Set(decks.map((deck) => deck.id)).size === decks.length,
    decks.map((deck) => deck.id).join(", ")
  );

  for (const deck of decks) {
    check(
      `${deck.id}: เล่นได้จริง`,
      isDeckPlayable(deck) && deckIssues(deck, "en").length === 0,
      `name="${deck.name}" chars=${deck.characters.length} size=${deckSize(deck)} ${JSON.stringify(
        deckIssues(deck, "en")
      )}`
    );
    // The engine is the real judge: a list that passes deckIssues but cannot be
    // dealt would still fail at createMatch.
    const setup = deckToSetup(deck);
    check(
      `${deck.id}: แจกลงสนามได้ตามกติกา`,
      validateDecks(setup.characterDeck, setup.actionDeck).length === 0,
      validateDecks(setup.characterDeck, setup.actionDeck).join(" | ")
    );
  }

  // A starter is a deck a player could have written out themselves, so a round
  // trip through the text format has to come back identical.
  for (const deck of decks) {
    const again = parseDeck(formatDeck(deck), deck.id, deck.id).deck;
    check(
      `${deck.id}: export แล้ว import กลับ ได้เด็คเดิม`,
      JSON.stringify(again) === JSON.stringify(deck),
      `${JSON.stringify(again.characters)} vs ${JSON.stringify(deck.characters)}`
    );
  }

  // Fresh objects each call: the builder mutates a DeckList in place, so a
  // shared reference would let unsaved edits leak into the built-in deck.
  const a = starterDecks()[0];
  a.cards["BP01-069"] = 99;
  check(
    "starterDecks() คืนหน่วยใหม่ทุกครั้ง แก้แล้วไม่กระทบต้นฉบับ",
    starterDecks()[0].cards["BP01-069"] !== 99,
    `${starterDecks()[0].cards["BP01-069"]}`
  );
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
