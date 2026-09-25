// The layer between the engine and a socket.
//
// `step` is a pure rules function and does not care who called it. Over a
// network that is not enough: someone has to decide which seat is allowed to
// speak, hold a half-finished move while its question is open, and hand each
// player a view with the other hand taken out. That is MatchSession, and this
// is what checks it — especially the parts where getting it wrong would let
// one player drive the other's turn or read their hand.
//
// Run with: npm run test:session
import { requireCard } from "../src/cardDb";
import { playableCharacters } from "../src/decks";
import { HIDDEN_CARD_ID } from "../src/game";
import type { ActionCard, CharacterCard } from "../src/game";
import { createMatch } from "../src/match";
import { ACTION_DECK_SIZE } from "../src/rules";
import { MatchSession, dealMatch, firstSeatFor, starterDeck } from "../src/session";
import type { DeckList } from "../src/deckList";
import type { Seat } from "../src/types";
import { SEATS } from "../src/types";

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  [${detail}]` : ""}`);
  ok ? (pass += 1) : (fail += 1);
};

const [FIRST, SECOND] = playableCharacters();
const PICKS: Record<Seat, DeckList> = { p1: starterDeck(FIRST), p2: starterDeck(SECOND) };

/**
 * A session sat at turn 1 with p1 to move.
 *
 * Both defaults are pinned: a real deal tosses a coin for the first turn and
 * opens on the mulligan, and these cases are about who is allowed to speak,
 * not about either of those. The opening itself is checked below.
 */
function fresh(): MatchSession {
  return MatchSession.deal("test", PICKS, 12345, { startingPlayerId: "p1", skipMulligan: true });
}

function character(id: string): CharacterCard {
  const def = requireCard(id);
  if (def.type !== "leader") throw new Error(`${id} is not a character card`);
  return { id: def.id, name: def.name, level: def.level, imageId: def.imageId };
}

function action(id: string): ActionCard {
  const def = requireCard(id);
  if (def.type !== "action") throw new Error(`${id} is not an action card`);
  return {
    id: def.id,
    name: def.name,
    color: def.color,
    cost: def.cost,
    damage: def.attack,
    speed: def.speed ?? 0,
    imageId: def.imageId,
  };
}

/** A 40-card deck built by repeating the ids given, in order. */
function deck(ids: string[]): ActionCard[] {
  const out: ActionCard[] = [];
  while (out.length < ACTION_DECK_SIZE) out.push(action(ids[out.length % ids.length]));
  return out;
}

const SHOREKEEPER = ["BP01-010", "BP01-008", "BP01-024", "BP01-027"].map(character);
const ENCORE = ["BP01-015", "BP01-013", "BP01-030", "BP01-033"].map(character);

// --- Dealing ---------------------------------------------------------------

{
  const state = dealMatch("test", PICKS, 99);
  check("แจกการ์ดแล้วได้ผู้เล่นสองฝั่ง", Object.keys(state.boards).join(",") === "p1,p2");
  check(
    "สุ่มคนเริ่มก่อน และเทิร์นแรกเป็นของคนนั้น",
    SEATS.includes(state.startingPlayerId as Seat) &&
      state.turnPlayerId === state.startingPlayerId,
    state.startingPlayerId
  );
  check("แจกแล้วเริ่มที่เฟสเลือก Leader", state.phase === "leaderSelect", state.phase);
  check("ทั้งคู่มีการ์ดในมือ", state.boards.p1.hand.length > 0 && state.boards.p2.hand.length > 0);
  check(
    "สองฝั่งจั่วไม่เหมือนกัน",
    state.boards.p1.hand.map((c) => c.id).join(",") !==
      state.boards.p2.hand.map((c) => c.id).join(",")
  );

  const again = dealMatch("test", PICKS, 99);
  check(
    "seed เดิม -> แจกเหมือนเดิม",
    again.boards.p1.hand.map((c) => c.id).join(",") ===
      state.boards.p1.hand.map((c) => c.id).join(",")
  );
  check(
    "seed เดิม -> ได้คนเริ่มก่อนคนเดิม",
    again.startingPlayerId === state.startingPlayerId
  );
  const other = dealMatch("test", PICKS, 100);
  check(
    "seed ใหม่ -> แจกไม่เหมือนเดิม",
    other.boards.p1.hand.map((c) => c.id).join(",") !==
      state.boards.p1.hand.map((c) => c.id).join(",")
  );

  // A coin toss that always lands the same way is not a coin toss. Over a
  // spread of seeds both seats must come up.
  const opened = new Set(
    Array.from({ length: 40 }, (_, i) => firstSeatFor("coin", i * 7919 + 3))
  );
  check("สุ่มแล้วได้ทั้งสองฝั่ง ไม่ใช่ฝั่งเดิมตลอด", opened.size === SEATS.length, [...opened].join(","));
}

// --- Leader Select over a session -------------------------------------------
//
// Both seats answer it on their own, neither is the "turn player" for it, and
// the mulligan does not open until both have arranged their starters.

{
  const session = MatchSession.deal("leader", PICKS, 4242);
  check("แจกแล้วอยู่ที่เฟสเลือก Leader", session.state.phase === "leaderSelect", session.state.phase);
  check(
    "log บอกว่าใครเริ่มก่อน",
    session.log.some((line) => line.th.includes(session.state.startingPlayerId)),
    session.log[0]?.th ?? ""
  );
  check(
    "ระหว่างเลือก Leader เริ่มเทิร์นไม่ได้",
    !session.apply(session.state.startingPlayerId as Seat, { kind: "startTurn" })
  );

  const leaderId = session.state.boards.p2.leader!.card.id;
  check(
    "ฝ่ายที่ไม่ใช่เจ้าของเทิร์นก็เลือก Leader ได้",
    session.apply("p2", { kind: "chooseLeader", leaderId }),
    session.errorFor("p2") ?? ""
  );
  check("ยังไม่เข้าเฟสเปลี่ยนการ์ด เพราะอีกฝ่ายยังไม่เลือก", session.state.phase === "leaderSelect");
  check("เลือกซ้ำไม่ได้", !session.apply("p2", { kind: "chooseLeader", leaderId }));
  check(
    "อีกฝ่ายเลือกแล้วเข้าเฟสเปลี่ยนการ์ด",
    session.apply("p1", { kind: "chooseLeader", leaderId: session.state.boards.p1.leader!.card.id })
  );
  check("เข้าเฟสเปลี่ยนการ์ด", session.state.phase === "mulligan", session.state.phase);
}

// --- The opening mulligan over a session -----------------------------------
//
// Both seats answer it, neither is the "turn player" for it, and the match
// does not start until both are in.

{
  const session = MatchSession.deal("mull", PICKS, 4242);
  for (const seat of SEATS) {
    session.apply(seat, { kind: "chooseLeader", leaderId: session.state.boards[seat].leader!.card.id });
  }
  check("เลือก Leader ครบแล้วอยู่ที่เฟสเปลี่ยนการ์ด", session.state.phase === "mulligan", session.state.phase);
  check(
    "ระหว่างเปลี่ยนการ์ด เริ่มเทิร์นไม่ได้",
    !session.apply(session.state.startingPlayerId as Seat, { kind: "startTurn" })
  );

  const backs = session.state.boards.p2.hand.slice(0, 2).map((card) => card.id);
  check("ฝ่ายที่ไม่ใช่เจ้าของเทิร์นก็เปลี่ยนการ์ดได้", session.apply("p2", { kind: "mulligan", cardIds: backs }), session.errorFor("p2") ?? "");
  check("ยังไม่เริ่ม เพราะอีกฝ่ายยังไม่เลือก", session.state.phase === "mulligan");
  check("เลือกซ้ำไม่ได้", !session.apply("p2", { kind: "mulligan", cardIds: [] }));
  check("อีกฝ่ายเลือกแล้วเกมเริ่ม", session.apply("p1", { kind: "mulligan", cardIds: [] }));
  check("เข้าเฟสจั่ว", session.state.phase === "draw", session.state.phase);
  check("มือยังเป็น 5 ใบทั้งคู่", session.state.boards.p1.hand.length === 5 && session.state.boards.p2.hand.length === 5);
}

// --- Who is allowed to speak ----------------------------------------------
//
// startTurn and resolveCounter act on the board rather than on a player, so
// the engine never looks at who asked. Without a check here, either player
// could drive the other's turn from their own browser.

{
  const session = fresh();
  check("ไม่ใช่เทิร์นตัวเอง: เริ่มเทิร์นแทนอีกฝ่ายไม่ได้", !session.apply("p2", { kind: "startTurn" }));
  check("และได้เหตุผลกลับมา", session.errorFor("p2") === "It is not your turn", session.errorFor("p2") ?? "");
  check("อีกฝ่ายไม่เห็น error ของคนอื่น", session.errorFor("p1") === null);
  check("เจ้าของเทิร์นเริ่มเทิร์นได้", session.apply("p1", { kind: "startTurn" }));
  check("เข้าเฟสแอ็กชัน", session.state.phase === "action", session.state.phase);
}

{
  const session = fresh();
  session.apply("p1", { kind: "startTurn" });
  check(
    "ไม่ใช่เทิร์นตัวเอง: จบเทิร์นให้อีกฝ่ายไม่ได้",
    !session.apply("p2", { kind: "endTurn" })
  );
  // Cards go down in the Counter Phase, which the turn player opens on
  // purpose. Until they do, nobody lays anything out — that is what keeps
  // the other side from ending the turn player's Action Phase for them.
  check(
    "เฟสแอ็กชันของอีกฝ่าย: ลงการ์ดคว่ำยังไม่ได้",
    !session.apply("p2", { kind: "commit", cardId: session.state.boards.p2.hand[0].id })
  );
  check(
    "และบอกเหตุผลว่าต้องอยู่ในเฟสประลอง",
    session.errorFor("p2") === "Cards are committed in the Counter Phase",
    session.errorFor("p2") ?? ""
  );
  check("เมนเฟสของเจ้าของเทิร์นยังอยู่", session.state.phase === "action", session.state.phase);
  check("อีกฝ่ายเปิดเฟสประลองเองไม่ได้", !session.apply("p2", { kind: "toBattle" }));
  check(
    "และบอกว่าไม่ใช่เทิร์นของเขา",
    session.errorFor("p2") === "It is not your turn",
    session.errorFor("p2") ?? ""
  );

  // Once the turn player opens it, the phase belongs to both of them.
  check("เจ้าของเทิร์นกด Battle ได้", session.apply("p1", { kind: "toBattle" }));
  check("เข้าเฟสประลอง", session.state.phase === "counter", session.state.phase);
  check(
    "เปิดแล้ว -> อีกฝ่ายลงการ์ดคว่ำในเทิร์นอีกฝ่ายได้",
    session.apply("p2", { kind: "commit", cardId: session.state.boards.p2.hand[0].id }),
    session.errorFor("p2") ?? ""
  );
  check("การ์ดคว่ำอยู่ที่ p2 จริง", session.state.facedown.p2 !== null);
}

// เปิดการ์ดเป็นของเจ้าของเทิร์น
{
  const session = fresh();
  session.apply("p1", { kind: "startTurn" });
  session.apply("p1", { kind: "toBattle" });
  session.apply("p1", { kind: "commit", cardId: session.state.boards.p1.hand[0].id });
  session.apply("p2", { kind: "commit", cardId: session.state.boards.p2.hand[0].id });
  check("เปิดการ์ด: อีกฝ่ายสั่งไม่ได้", !session.apply("p2", { kind: "resolveCounter" }));
  check("เปิดการ์ด: เจ้าของเทิร์นสั่งได้", session.apply("p1", { kind: "resolveCounter" }));
}

// --- Each side's own view -------------------------------------------------

{
  const session = fresh();
  const mine = session.updateFor("p1").view;
  check("มุมมอง p1: เห็นมือตัวเอง", mine.boards.p1.hand.every((c) => !c.id.startsWith(HIDDEN_CARD_ID)));
  check(
    "มุมมอง p1: มือ p2 เป็นการ์ดคว่ำ แต่ยังนับใบได้",
    mine.boards.p2.hand.length === session.state.boards.p2.hand.length &&
      mine.boards.p2.hand.every((c) => c.id.startsWith(HIDDEN_CARD_ID))
  );
  check("มุมมองไม่แตะของจริง", session.state.boards.p2.hand.every((c) => c.name !== ""));
}

// --- A question stops the move until it is answered ------------------------
//
// Built deliberately rather than played into: BP01-010 Shorekeeper asks its
// controller a question when they counter with a green card, so putting
// Shorekeeper on p2 and the green card in p2's hand produces the case that
// only exists over a network — p1 makes the move, p2 is the one asked.

function withQuestion(): MatchSession {
  const state = createMatch({
    matchId: "session-question",
    startingPlayerId: "p1",
    players: [
      { playerId: "p1", characterDeck: ENCORE, actionDeck: deck(["BP01-044"]) },
      { playerId: "p2", characterDeck: SHOREKEEPER, actionDeck: deck(["BP01-052"]) },
    ],
  });
  state.phase = "counter";
  state.boards.p1.hand = [action("BP01-044")]; // red
  state.boards.p2.hand = [action("BP01-058")]; // green — this is what asks

  const session = new MatchSession(state);
  session.apply("p1", { kind: "commit", cardId: "BP01-044" });
  session.apply("p2", { kind: "commit", cardId: "BP01-058" });
  session.apply("p1", { kind: "resolveCounter" });
  return session;
}

{
  const session = withQuestion();
  const open = session.question;
  check("เปิดการ์ดแล้วมีคำถามค้าง", open !== null);

  if (open) {
    check("คนสั่งคือ p1 แต่คนถูกถามคือ p2", open.actor === "p1" && open.choice.playerId === "p2");
    check("p2 เห็นคำถาม", session.updateFor("p2").pending !== null);
    check("p1 ไม่เห็นคำถามของ p2", session.updateFor("p1").pending === null);
    check("แต่ p1 รู้ว่ากำลังรอ p2 อยู่", session.updateFor("p1").askingSeat === "p2");

    // The clash reveal is the one half-applied board both sides see: the
    // cards are up either way, and the reveal cut-in has to play for both
    // at once rather than for p1 only after p2 has answered.
    check(
      "p2 เห็นกระดานครึ่งทาง (การ์ดเปิดแล้ว)",
      session.updateFor("p2").view.actionZone.p2.length > 0
    );
    check(
      "ตอนเปิดการ์ด p1 ก็เห็นการ์ดที่เปิดพร้อมกัน",
      session.updateFor("p1").view.actionZone.p2.length > 0
    );
    check(
      "แต่มือของ p2 ยังคว่ำอยู่สำหรับ p1",
      session.updateFor("p1").view.boards.p2.hand.every((c) => c.id.startsWith("hidden"))
    );

    check("p1 ตอบแทน p2 ไม่ได้", !session.answer("p1", true));
    check("และคำถามยังค้างอยู่", session.question !== null);
    check("p2 ยกเลิกการสั่งของ p1 ไม่ได้", !session.cancel("p2"));
    check("ระหว่างมีคำถามค้าง สั่งอย่างอื่นไม่ได้", !session.apply("p1", { kind: "endTurn" }));
    check(
      "และได้เหตุผลว่าติดคำถามอยู่",
      session.errorFor("p1") === "There is a question waiting to be answered",
      session.errorFor("p1") ?? ""
    );

    const before = session.state.boards.p2.hand.length;
    check("p2 ตอบเองได้", session.answer("p2", true));
    check("ตอบแล้วคำถามหายไป", session.question === null);
    check(
      "ตอบตกลง -> p2 ได้การ์ดขึ้นมือ",
      session.state.boards.p2.hand.length === before + 1,
      `${before} -> ${session.state.boards.p2.hand.length}`
    );
  }
}

// --- Cancelling belongs to whoever made the move ---------------------------

{
  const session = withQuestion();
  const zoneBefore = JSON.stringify(session.state.actionZone);
  check("คนที่ไม่ได้สั่งยกเลิกไม่ได้", !session.cancel("p2"));
  check("คนที่สั่งยกเลิกได้", session.cancel("p1"));
  check("ยกเลิกแล้วไม่มีคำถามค้าง", session.question === null);
  check(
    "และกระดานกลับไปเหมือนก่อนสั่ง",
    JSON.stringify(session.state.actionZone) === zoneBefore
  );
}

// --- Conceding ------------------------------------------------------------

{
  const session = fresh();
  check("ยอมแพ้ได้ตลอด", session.apply("p2", { kind: "concede" }));
  check("อีกฝ่ายชนะ", session.winnerId === "p1", String(session.winnerId));
  check("จบแล้วสั่งต่อไม่ได้", !session.apply("p1", { kind: "startTurn" }));
}

// --- Forfeiting: for a player who left, not one still asking to concede ----
//
// This is what the server calls when someone leaves the room or disappears
// past their grace period — never a move the player themselves sent, so it
// must not go through the same refusals a real move would.

{
  const session = fresh();
  session.forfeit("p2");
  check("ฝ่ายที่เหลือชนะ", session.winnerId === "p1", String(session.winnerId));
  check(
    "บันทึกลง log ว่าออกจากเกม",
    session.log.some((line) => line.en.includes("p2") && line.en.includes("left")),
    session.log.at(-1)?.en ?? ""
  );
}

{
  // The one case forfeit exists for: a question is open (so apply() would
  // refuse everything, concede included) and nobody is coming back to
  // answer it.
  const session = withQuestion();
  check("มีคำถามค้างอยู่ก่อน", session.question !== null);
  session.forfeit(session.question!.actor);
  check("forfeit เคลียร์คำถามที่ค้างอยู่ได้ ไม่ติดขัด", session.question === null);
  check("ประกาศผู้ชนะได้ทั้งที่คำถามค้าง", session.winnerId !== null, String(session.winnerId));
}

{
  // A match already decided stays decided — a stray disconnect timer firing
  // after the fact must not overturn a real result.
  const session = fresh();
  session.apply("p2", { kind: "concede" });
  const before = session.winnerId;
  session.forfeit("p1");
  check("จบไปแล้วครั้งหนึ่ง -> forfeit อีกฝ่ายไม่เปลี่ยนผล", session.winnerId === before, String(session.winnerId));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
