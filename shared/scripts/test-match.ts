// Plays real turns through the real engine with real cards.
//
// The other suites each poke at one piece. This one is the only test that
// answers "does a game actually run" — setup, draw, actions, the clash, a
// combo, the end phase, and the turn passing over.
//
// Run with: npm run test:match
import { requireCard } from "../src/cardDb";
import type { ChoiceAnswer } from "../src/cardDef";
import { effectiveCost, recomputeContinuous, resolveTrigger, sourcesInPlay } from "../src/effects";
import {
  canCommit,
  canCommitAnything,
  canPassCounter,
  canSwitchLeader,
  createMatch,
  legalIntents,
  levelUpOptions,
  step,
  viewFor,

  type MatchIntent,
  type StepResult,
} from "../src/match";
import type { ActionCard, CharacterCard, MatchState } from "../src/game";
import { CHARGE_PER_TURN, HAND_LIMIT, HIDDEN_CARD_ID, INITIAL_HAND_SIZE, isHiddenCard } from "../src/game";
import { ACTION_DECK_SIZE } from "../src/rules";
import type { LogLine } from "../src/log";

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  [${detail}]` : ""}`);
  ok ? (pass += 1) : (fail += 1);
};

// --- Building a legal match ------------------------------------------------

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
    // Blue cards print no Speed; combat never reads it for blue-on-blue.
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

// Three characters take the field, so every Character Deck below names three
// with a Level 0 card. CAMELLYA leads the first, ENCORE the second.
const CAMELLYA = [
  "BP01-005", "BP01-003", "BP01-001", // Camellya  L0 -> L1 -> L2
  "BP01-024", "BP01-023",             // Yangyang  L0 -> L1
  "BP01-027", "BP01-026",             // Chixia    L0 -> L1
];
const ENCORE = [
  "BP01-015", "BP01-013", "BP01-011", // Encore
  "BP01-030", "BP01-029",             // Jinshi
  "BP01-033", "BP01-032",             // Sanhua
];

// BP01-044 red spd8 atk1, BP01-049 red cost2 spd13 atk5, BP01-045 blue atk3.
const P1_DECK = ["BP01-044", "BP01-049", "BP01-047", "BP01-045"];
const P2_DECK = ["BP01-045", "BP01-044", "BP01-047", "BP01-049"];

function newMatch(): MatchState {
  return createMatch({
    matchId: "test",
    startingPlayerId: "p1",
    // These cases are about the turn, not the opening: dealing into the
    // mulligan would make every one of them play two moves before reaching
    // the rule it is actually checking. The mulligan has its own block below.
    skipMulligan: true,
    players: [
      { playerId: "p1", characterDeck: CAMELLYA.map(character), actionDeck: deck(P1_DECK) },
      { playerId: "p2", characterDeck: ENCORE.map(character), actionDeck: deck(P2_DECK) },
    ],
  });
}

/**
 * Drives one intent to completion the way the server will: answer every
 * question the step raises, replaying from the same state each time.
 *
 * Questions are answered by `reply`; the default takes the first option, or
 * yes. Returns the finished result plus the questions that came up.
 */
function drive(
  state: MatchState,
  playerId: string,
  intent: MatchIntent,
  reply: (choice: NonNullable<StepResult["pending"]>) => ChoiceAnswer = (choice) =>
    choice.kind === "confirm" ? true : choice.options[0]?.value ?? ""
): { result: StepResult; asked: string[] } {
  const asked: string[] = [];
  const play = (
    from: MatchState,
    actor: string,
    what: MatchIntent,
    record: string[]
  ): StepResult => {
    const answers: ChoiceAnswer[] = [];
    for (let guard = 0; guard < 20; guard += 1) {
      const result = step(from, actor, what, answers);
      if (!result.pending) return result;
      record.push(result.pending.cardId);
      answers.push(reply(result.pending));
    }
    throw new Error("a step kept asking questions — it is not replaying deterministically");
  };

  // Cards are laid down in the Counter Phase, and the turn player opens that
  // phase with `toBattle` — committing no longer does it for them. Almost
  // every case below is about what the clash DOES rather than about how the
  // phase was opened, so the harness walks through the door on their behalf.
  // The cases that are about the door itself call toBattle themselves, and
  // if it ever stops working these all fail with it.
  //
  // Questions raised by opening the phase are answered but kept out of
  // `asked`, which belongs to the intent the caller actually asked about.
  let from = state;
  if ((intent.kind === "commit" || intent.kind === "pass") && from.phase === "action") {
    from = play(from, from.turnPlayerId, { kind: "toBattle" }, []).state;
  }
  return { result: play(from, playerId, intent, asked), asked };
}

// --- Setup -----------------------------------------------------------------

{
  const s = newMatch();
  check("ตั้งเกม: Leader เป็นการ์ด Level 0", s.boards.p1.leader?.card.id === "BP01-005");
  check("มือเริ่มต้น 5 ใบ", s.boards.p1.hand.length === 5, `${s.boards.p1.hand.length}`);
  check(
    "เด็คเหลือ 35 ใบ",
    s.boards.p1.actionDeck.length === ACTION_DECK_SIZE - 5,
    `${s.boards.p1.actionDeck.length}`
  );
  check(
    "ลงสนาม 3 ตัว: Leader 1 + หลัง 2",
    s.boards.p1.leader !== null && s.boards.p1.back.length === 2,
    `back=${s.boards.p1.back.length}`
  );
  check(
    "ตัวที่ลงสนามเป็นคนละตัวละคร",
    new Set([s.boards.p1.leader!.card.name, ...s.boards.p1.back.map((b) => b.card.name)]).size === 3
  );
  check("ทุกตัวเริ่มที่ Level 0", s.boards.p1.back.every((b) => b.card.level === 0));
  check(
    "การ์ดตัวละครที่เหลืออยู่ใน pool",
    s.boards.p1.characterPool.length === CAMELLYA.length - 3,
    `${s.boards.p1.characterPool.length}`
  );
  check("เริ่มที่เฟสจั่ว เทิร์น 1", s.phase === "draw" && s.turnNumber === 1);

  let threw = "";
  try {
    createMatch({
      matchId: "bad",
      startingPlayerId: "p1",
      players: [
        { playerId: "p1", characterDeck: [character("BP01-005")], actionDeck: deck(P1_DECK) },
        { playerId: "p2", characterDeck: ENCORE.map(character), actionDeck: deck(P2_DECK) },
      ],
    });
  } catch (error) {
    threw = error instanceof Error ? error.message : String(error);
  }
  check("เด็คตัวละครน้อยเกินไป -> ไม่ยอมเริ่มเกม", threw.includes("Character Deck"), threw);
}

// --- Running the deck out --------------------------------------------------
//
// Not a loss in these rules: the trash is shuffled and becomes the deck
// again. Every path that takes cards off the top goes through takeFromDeck,
// so this is checked where it is most visible — the Draw Phase.

{
  let s = newMatch();
  // Deck empty, trash full.
  s.boards.p1.trash = s.boards.p1.actionDeck.splice(0, 10);
  s.boards.p1.actionDeck = [];
  const inTrash = s.boards.p1.trash.length;
  const inHand = s.boards.p1.hand.length;

  const out = step(s, "p1", { kind: "startTurn" });
  s = out.state;
  check(
    "เด็คหมด -> นำกองทิ้งมาสับเป็นเด็คใหม่",
    s.boards.p1.actionDeck.length === inTrash - 1,
    `${s.boards.p1.actionDeck.length} (กองทิ้งเดิม ${inTrash})`
  );
  check("กองทิ้งว่างลงหลังสับกลับ", s.boards.p1.trash.length === 0, `${s.boards.p1.trash.length}`);
  check("จั่วได้ตามปกติ", s.boards.p1.hand.length === inHand + 1, `${s.boards.p1.hand.length}`);
  check(
    "log บอกว่าสับกองทิ้งกลับเป็นเด็ค",
    out.log.some((line) => line.th.includes("สับเป็นเด็คใหม่")),
    out.log.map((l) => l.th).join(" | ")
  );
}

{
  // The refill has to happen PART-WAY through a draw too: one card left and
  // two to draw takes that card, recycles, and takes the second off the new
  // deck. Turn 2 so the draw is the normal two.
  let s = newMatch();
  s.turnNumber = 2;
  // Everything but the top card into the trash, so nothing is thrown away
  // and the 40 can still be counted at the end.
  const deckNow = s.boards.p1.actionDeck;
  s.boards.p1.trash = deckNow.slice(1);
  s.boards.p1.actionDeck = deckNow.slice(0, 1);
  const inHand = s.boards.p1.hand.length;
  const recycled = s.boards.p1.trash.length;

  s = step(s, "p1", { kind: "startTurn" }).state;
  check("จั่ว 2 โดยเหลือเด็ค 1 -> ได้ครบ 2 ใบ", s.boards.p1.hand.length === inHand + 2, `${s.boards.p1.hand.length}`);
  check(
    "ใบที่สองมาจากเด็คที่สับใหม่",
    s.boards.p1.actionDeck.length === recycled - 1 && s.boards.p1.trash.length === 0,
    `deck=${s.boards.p1.actionDeck.length} trash=${s.boards.p1.trash.length}`
  );
  check(
    "ไม่มีการ์ดหายไปไหน",
    s.boards.p1.hand.length + s.boards.p1.actionDeck.length + s.boards.p1.trash.length +
      s.boards.p1.competitionArea.length === ACTION_DECK_SIZE
  );
}

{
  // Both piles empty: nothing to recycle, nothing to draw, and it must not
  // spin or throw. The match carries on — running out is still not a loss.
  let s = newMatch();
  s.boards.p1.actionDeck = [];
  s.boards.p1.trash = [];
  const inHand = s.boards.p1.hand.length;
  const out = step(s, "p1", { kind: "startTurn" });
  s = out.state;
  check("เด็คและกองทิ้งว่างทั้งคู่ -> ไม่พัง", out.error === null, out.error ?? "");
  check("และไม่ได้การ์ดเพิ่ม", s.boards.p1.hand.length === inHand);
  check("แต่ยังเดินเกมต่อได้", s.phase === "action", s.phase);
  check(
    "log บอกว่าเด็คหมด",
    out.log.some((line) => line.th.includes("หมดแล้ว")),
    out.log.map((l) => l.th).join(" | ")
  );
}

// --- Leader Select -----------------------------------------------------
//
// Before the mulligan, both players may freely arrange their three Level 0
// starters between the Leader slot and the two Back slots (rule 101.4, "in
// any order"). Naming the character already in the Leader slot is how a
// player happy with the deck's default order confirms and moves on.

function mulliganMatch(): MatchState {
  return createMatch({
    matchId: "mulligan",
    startingPlayerId: "p1",
    players: [
      { playerId: "p1", characterDeck: CAMELLYA.map(character), actionDeck: deck(P1_DECK) },
      { playerId: "p2", characterDeck: ENCORE.map(character), actionDeck: deck(P2_DECK) },
    ],
  });
}

/** Both sides confirm whichever Leader is already up, to reach the mulligan. */
function pastLeaderSelect(state: MatchState): MatchState {
  let s = state;
  for (const playerId of Object.keys(s.boards)) {
    s = step(s, playerId, { kind: "chooseLeader", leaderId: s.boards[playerId].leader!.card.id }).state;
  }
  return s;
}

{
  // Nobody sees the other side's starters until the mulligan is over.
  const s = mulliganMatch();
  const back = s.boards.p1.back[0].card.id;
  const picked = step(s, "p1", { kind: "chooseLeader", leaderId: back });
  check("เลือก Leader: log ไม่บอกอีกฝ่าย", !picked.log.some((l) => l.en.includes("as Leader")));
  const other = viewFor(picked.state, "p2").boards.p1;
  check(
    "ช่วงเลือก Leader: อีกฝ่ายเห็นตัวละครคว่ำอยู่",
    [other.leader, ...other.back].every((slot) => !slot || isHiddenCard(slot.card))
  );
  check("ฝั่งตัวเองยังเห็นของตัวเอง", viewFor(picked.state, "p1").boards.p1.leader?.card.id === back);
  let m = step(picked.state, "p2", { kind: "chooseLeader", leaderId: s.boards.p2.leader!.card.id }).state;
  check("ช่วงเปลี่ยนมือ: ยังคว่ำอยู่", isHiddenCard(viewFor(m, "p2").boards.p1.leader!.card));
  m = step(m, "p1", { kind: "mulligan", cardIds: [] }).state;
  const done = step(m, "p2", { kind: "mulligan", cardIds: [] });
  check("เปลี่ยนมือเสร็จทั้งคู่: เห็น Leader อีกฝ่าย", viewFor(done.state, "p2").boards.p1.leader?.card.id === back);
  check("เปลี่ยนมือเสร็จ: log บอก Leader ทั้งสองฝ่าย", done.log.filter((l) => l.en.includes("as Leader")).length === 2);
}

{
  const s = mulliganMatch();
  check("แจกการ์ดแล้วเริ่มที่เฟสเลือก Leader", s.phase === "leaderSelect", s.phase);
  check("Leader เริ่มต้นเป็นตัวแรกตามลำดับเด็ค", s.boards.p1.leader?.card.id === "BP01-005");
  check("ยังไม่มีใครเลือก", !s.leaderChosen.p1 && !s.leaderChosen.p2);
  check(
    "ระหว่างเลือก Leader ยังเปลี่ยนมือไม่ได้",
    step(s, "p1", { kind: "mulligan", cardIds: [] }).error !== null
  );
  check(
    "ระหว่างเลือก Leader ยังเริ่มเทิร์นไม่ได้",
    step(s, "p1", { kind: "startTurn" }).error !== null
  );
  check(
    "ทั้งสองฝ่ายมีสิทธิ์เลือก Leader ไม่ใช่แค่เจ้าของเทิร์น",
    legalIntents(s, "p1").includes("chooseLeader") && legalIntents(s, "p2").includes("chooseLeader")
  );
  check(
    "เลือกตัวที่ไม่ได้อยู่ในสนามไม่ได้",
    step(s, "p1", { kind: "chooseLeader", leaderId: "not-a-real-card" }).error !== null
  );
}

{
  // Confirming the default: naming the character already in the Leader slot
  // leaves the roster untouched but still counts as having chosen.
  let s = mulliganMatch();
  const before = s.boards.p1.leader!.card.id;
  s = step(s, "p1", { kind: "chooseLeader", leaderId: before }).state;
  check("ยืนยัน Leader เดิม -> ตัวเดิมยังเป็น Leader", s.boards.p1.leader?.card.id === before);
  check("ยืนยันแล้ว -> ถือว่าเลือกแล้ว", s.leaderChosen.p1 === true);
  check("อีกฝ่ายยังไม่เลือก -> ยังไม่เข้าเฟสเปลี่ยนการ์ด", s.phase === "leaderSelect", s.phase);
  check("เลือกซ้ำไม่ได้", step(s, "p1", { kind: "chooseLeader", leaderId: before }).error !== null);

  s = step(s, "p2", { kind: "chooseLeader", leaderId: s.boards.p2.leader!.card.id }).state;
  check("ทั้งคู่เลือกแล้ว -> เข้าเฟสเปลี่ยนการ์ด", s.phase === "mulligan", s.phase);
}

{
  // Swapping in a Back character: it takes the Leader slot, the old Leader
  // moves to Back, and the roster is still the same three characters.
  let s = mulliganMatch();
  const backCharacter = s.boards.p1.back[0].card;
  const oldLeaderId = s.boards.p1.leader!.card.id;
  s = step(s, "p1", { kind: "chooseLeader", leaderId: backCharacter.id }).state;
  check("สลับ Leader ได้ตามใจ -> ตัวที่เลือกขึ้นมาเป็น Leader", s.boards.p1.leader?.card.id === backCharacter.id);
  check(
    "Leader เดิมย้ายไปอยู่ตำแหน่งหลังแทน",
    s.boards.p1.back.some((slot) => slot.card.id === oldLeaderId)
  );
  check(
    "ยังเป็นตัวละครคนละตัวกัน 3 ตัวเท่าเดิม",
    new Set([s.boards.p1.leader!.card.name, ...s.boards.p1.back.map((b) => b.card.name)]).size === 3
  );
}

// --- The opening mulligan --------------------------------------------------
//
// Five cards, put back as many as you like, shuffle, draw the same number
// again. Both players answer it before turn 1 starts, in either order.

{
  const s = pastLeaderSelect(mulliganMatch());
  check("เลือก Leader ครบแล้วเข้าเฟสเปลี่ยนการ์ด", s.phase === "mulligan", s.phase);
  check("ยังไม่มีใครเลือก", !s.mulliganDone.p1 && !s.mulliganDone.p2);
  check(
    "ระหว่างเปลี่ยนการ์ด ยังเริ่มเทิร์นไม่ได้",
    step(s, "p1", { kind: "startTurn" }).error !== null
  );
  check(
    "ระหว่างเปลี่ยนการ์ด ยังลงการ์ดคว่ำไม่ได้",
    step(s, "p1", { kind: "commit", cardId: s.boards.p1.hand[0].id }).error !== null
  );
  check(
    "ทั้งสองฝ่ายมีสิทธิ์เปลี่ยนการ์ด ไม่ใช่แค่เจ้าของเทิร์น",
    legalIntents(s, "p1").includes("mulligan") && legalIntents(s, "p2").includes("mulligan")
  );
}

{
  // Keeping the hand: a real answer, and it must not move a single card.
  let s = pastLeaderSelect(mulliganMatch());
  const before = s.boards.p1.hand.map((card) => card.id).join(",");
  const deckBefore = s.boards.p1.actionDeck.length;
  s = step(s, "p1", { kind: "mulligan", cardIds: [] }).state;
  check("ไม่เปลี่ยนเลย -> มือเดิมทุกใบ", s.boards.p1.hand.map((c) => c.id).join(",") === before);
  check("ไม่เปลี่ยนเลย -> เด็คเท่าเดิม", s.boards.p1.actionDeck.length === deckBefore);
  check("ไม่เปลี่ยนเลย -> ถือว่าเลือกแล้ว", s.mulliganDone.p1 === true);
  check("อีกฝ่ายยังไม่เลือก -> ยังไม่เริ่มเกม", s.phase === "mulligan", s.phase);
  check("เลือกซ้ำไม่ได้", step(s, "p1", { kind: "mulligan", cardIds: [] }).error !== null);

  s = step(s, "p2", { kind: "mulligan", cardIds: [] }).state;
  check("ทั้งคู่เลือกแล้ว -> เข้าเฟสจั่ว เทิร์น 1", s.phase === "draw" && s.turnNumber === 1);
  check("เริ่มเทิร์นได้แล้ว", step(s, "p1", { kind: "startTurn" }).error === null);
}

{
  // Putting cards back: the hand stays five, the deck stays forty minus five.
  let s = pastLeaderSelect(mulliganMatch());
  const handBefore = s.boards.p1.hand.length;
  const deckBefore = s.boards.p1.actionDeck.length;
  const putBack = s.boards.p1.hand.slice(0, 3).map((card) => card.id);
  s = step(s, "p1", { kind: "mulligan", cardIds: putBack }).state;
  check("คืน 3 จั่ว 3 -> มือเท่าเดิม", s.boards.p1.hand.length === handBefore, `${s.boards.p1.hand.length}`);
  check(
    "คืน 3 จั่ว 3 -> เด็คเท่าเดิม",
    s.boards.p1.actionDeck.length === deckBefore,
    `${s.boards.p1.actionDeck.length}`
  );
  check(
    "ไม่มีการ์ดหายไปไหน",
    s.boards.p1.hand.length + s.boards.p1.actionDeck.length + s.boards.p1.trash.length ===
      ACTION_DECK_SIZE
  );
  check("อีกฝ่ายไม่ถูกแตะ", s.boards.p2.hand.length === INITIAL_HAND_SIZE);

  // Whole hand back is legal — that is the worst opening the rules allow for.
  let all = pastLeaderSelect(mulliganMatch());
  all = step(all, "p2", {
    kind: "mulligan",
    cardIds: all.boards.p2.hand.map((card) => card.id),
  }).state;
  check("คืนทั้งมือได้", all.boards.p2.hand.length === INITIAL_HAND_SIZE && all.mulliganDone.p2);

  check(
    "คืนการ์ดที่ไม่ได้อยู่ในมือไม่ได้",
    step(pastLeaderSelect(mulliganMatch()), "p1", { kind: "mulligan", cardIds: ["BP01-999"] }).error !== null
  );
}

// --- Draw Phase ------------------------------------------------------------

let game = newMatch();
{
  const { result } = drive(game, "p1", { kind: "startTurn" });
  check("เทิร์นแรกของผู้เริ่ม จั่ว 1 ใบ", result.state.boards.p1.hand.length === 6, `${result.state.boards.p1.hand.length}`);
  check("จั่วจบแล้วเข้าเฟสแอ็กชัน", result.state.phase === "action");
  check("ไม่มีเอฟเฟคค้าง", result.error === null);
  game = result.state;
}

// --- Action Phase ----------------------------------------------------------

{
  const first = game.boards.p1.hand[0].id;
  const { result } = drive(game, "p1", { kind: "charge", cardIds: [first] });
  check("ชาร์จ: การ์ดย้ายไป Concerto", result.state.boards.p1.competitionArea.length === 1);
  check("ชาร์จ: มือลดลง", result.state.boards.p1.hand.length === 5);
  game = result.state;

  const again = step(game, "p1", { kind: "charge", cardIds: [game.boards.p1.hand[0].id] });
  check("ชาร์จซ้ำในเทิร์นเดียว -> ถูกปฏิเสธ", again.error !== null, again.error ?? "");
  check("ถูกปฏิเสธแล้ว state ไม่เปลี่ยน", again.state === game);

  const notMine = step(game, "p2", { kind: "charge", cardIds: [game.boards.p2.hand[0].id] });
  check("ไม่ใช่เทิร์นตัวเอง -> ถูกปฏิเสธ", notMine.error === "It is not your turn", notMine.error ?? "");
}

// --- Paying a cost happens when the card is turned up ----------------------

{
  const base = drive(newMatch(), "p1", { kind: "startTurn" }).result.state;

  const two = step(base, "p1", {
    kind: "charge",
    cardIds: [base.boards.p1.hand[0].id, base.boards.p1.hand[1].id],
  });
  check("ชาร์จ 2 ใบในเทิร์นเดียว -> ถูกปฏิเสธ", two.error !== null, two.error ?? "");
  check("ชาร์จได้เทิร์นละใบเดียว", CHARGE_PER_TURN === 1);

  // A cost 2 card with an empty Concerto area cannot even be committed.
  let s = structuredClone(base);
  s.phase = "counter";
  s.boards.p1.hand = [action("BP01-049")]; // Camellya, cost 2
  s.boards.p2.hand = [action("BP01-044")]; // cost 0
  const broke = step(s, "p1", { kind: "commit", cardId: "BP01-049" });
  check("จ่าย cost ไม่ไหว -> ลงไม่ได้", broke.error?.includes("Concerto") === true, broke.error ?? "");

  // With enough charged it commits — but nothing is spent while it is still
  // face-down, because a card that has not been turned up has not been played.
  s.boards.p1.competitionArea = [action("BP01-044"), action("BP01-047")];
  const committed = step(s, "p1", { kind: "commit", cardId: "BP01-049" });
  check("ลงคว่ำได้", committed.error === null, committed.error ?? "");
  check(
    "ยังคว่ำอยู่ -> ยังไม่จ่าย",
    committed.state.boards.p1.competitionArea.length === 2,
    `เหลือ ${committed.state.boards.p1.competitionArea.length}`
  );

  const both = step(committed.state, "p2", { kind: "commit", cardId: "BP01-044" });
  const { result } = drive(both.state, "p1", { kind: "resolveCounter" });
  check(
    "หงายการ์ดแล้วจึงจ่าย",
    result.state.boards.p1.competitionArea.length === 0,
    `เหลือ ${result.state.boards.p1.competitionArea.length}`
  );
  // They land in the trash, but Camellya's own Leader Skill may immediately
  // pull a {Basic Attack} back out of it — so the check is that they left the
  // Concerto area, not that they are still sitting in the trash.
  const paidCards = ["BP01-044", "BP01-047"];
  check(
    "การ์ดที่จ่ายไปออกจาก Concerto",
    paidCards.every((id) => !result.state.boards.p1.competitionArea.some((c) => c.id === id)),
    JSON.stringify(result.state.boards.p1.competitionArea.map((c) => c.id))
  );
  check(
    "และไปโผล่ที่กองทิ้ง (หรือถูกเอฟเฟคดึงกลับขึ้นมือ)",
    paidCards.every(
      (id) =>
        result.state.boards.p1.trash.some((c) => c.id === id) ||
        result.state.boards.p1.hand.some((c) => c.id === id)
    ),
    `trash=${result.state.boards.p1.trash.map((c) => c.id).join(",")} hand=${result.state.boards.p1.hand.map((c) => c.id).join(",")}`
  );
  check(
    "บันทึกการจ่ายลงล็อก",
    result.log.some((line) => line.th.includes("จ่าย 2")),
    result.log.filter((l) => l.th.includes("จ่าย")).map((l) => l.th).join(" | ")
  );

  // Paying is exact: a cost 1 card takes one of the two and leaves one.
  let one = structuredClone(s);
  one.boards.p1.hand = [action("BP01-048")]; // cost 1
  const c1 = step(one, "p1", { kind: "commit", cardId: "BP01-048" });
  const c2 = step(c1.state, "p2", { kind: "commit", cardId: "BP01-044" });
  const partial = drive(c2.state, "p1", { kind: "resolveCounter" }).result;
  check(
    "จ่ายพอดี ไม่ใช้เกิน",
    partial.state.boards.p1.competitionArea.length === 1,
    `เหลือ ${partial.state.boards.p1.competitionArea.length}`
  );

  check("มีพลังงานพอ -> ลงการ์ดได้", canCommitAnything(base, "p1") === true);
  const noEnergy = structuredClone(base);
  noEnergy.boards.p1.hand = [action("BP01-049")];
  noEnergy.boards.p1.competitionArea = [];
  check("มีแต่การ์ดที่จ่ายไม่ไหว -> ต้องกดไม่ลงการ์ด", canCommitAnything(noEnergy, "p1") === false);
}

// --- Leader Skill cards require their matching active Leader ----------------

{
  // BP01-048 is printed [Leader Skill] for Camellya. It must be rejected
  // before commitment under another Leader, rather than landing as a blank
  // attack and silently skipping its effect after reveal.
  const wrongLeader = newMatch();
  wrongLeader.phase = "counter";
  wrongLeader.boards.p1.leader = {
    position: "leader",
    card: character("BP01-024"), // Yangyang
    under: [],
  };
  wrongLeader.boards.p1.hand = [action("BP01-048")];
  wrongLeader.boards.p1.competitionArea = [action("BP01-044")];
  const blockedSkill = step(wrongLeader, "p1", { kind: "commit", cardId: "BP01-048" });
  check(
    "Leader Skill: Leader ไม่ตรง -> ลง BP01-048 ไม่ได้",
    blockedSkill.error?.includes("requires Camellya as your active Leader") === true,
    blockedSkill.error ?? ""
  );
  check("Leader Skill ที่ลงไม่ได้ไม่นับเป็นการ์ดที่เล่นได้", !canCommitAnything(wrongLeader, "p1"));

  const matchingLeader = structuredClone(wrongLeader);
  matchingLeader.boards.p1.leader = {
    position: "leader",
    card: character("BP01-005"), // Camellya
    under: [],
  };
  const allowedSkill = step(matchingLeader, "p1", { kind: "commit", cardId: "BP01-048" });
  check("Leader Skill: Camellya เป็น Leader -> ลง BP01-048 ได้", allowedSkill.error === null, allowedSkill.error ?? "");

  // BP01-062 is Encore-branded but has no [Leader Skill] tag, so it remains
  // an ordinary action card: another Leader cannot stop it being played.
  const ordinary = structuredClone(wrongLeader);
  ordinary.boards.p1.hand = [action("BP01-062")];
  ordinary.boards.p1.competitionArea = [action("BP01-044"), action("BP01-044")];
  const allowedOrdinary = step(ordinary, "p1", { kind: "commit", cardId: "BP01-062" });
  check("ไม่มี Leader Skill: BP01-062 ลงได้กับ Leader คนอื่น", allowedOrdinary.error === null, allowedOrdinary.error ?? "");

  // BP01-061, on the other hand, IS printed [Leader Skill] (リーダースキル on
  // the card), so it needs Encore leading like any other.
  const encoreSkill = structuredClone(wrongLeader);
  encoreSkill.boards.p1.hand = [action("BP01-061")];
  encoreSkill.boards.p1.competitionArea = [];
  const blocked061 = step(encoreSkill, "p1", { kind: "commit", cardId: "BP01-061" });
  check(
    "Leader Skill: Leader ไม่ใช่ Encore -> ลง BP01-061 ไม่ได้",
    blocked061.error?.includes("requires Encore as your active Leader") === true,
    blocked061.error ?? ""
  );
  encoreSkill.boards.p1.leader = { position: "leader", card: character("BP01-015"), under: [] }; // Encore
  const allowed061 = step(encoreSkill, "p1", { kind: "commit", cardId: "BP01-061" });
  check("Leader Skill: Encore เป็น Leader -> ลง BP01-061 ได้", allowed061.error === null, allowed061.error ?? "");
}

// --- Level Up, and a card that asks a question -----------------------------

{
  // BP01-003 is "[Enter] / [Level up] you may take a {Basic Attack} from the
  // trash" — it asks, so this exercises suspend-and-replay through a step.
  const seeded = structuredClone(game);
  seeded.boards.p1.trash.push(action("BP01-051")); // a {Basic Attack} to fetch
  seeded.boards.p1.hand = seeded.boards.p1.hand.filter((c) => c.id !== "BP01-051");
  const discard = seeded.boards.p1.hand[0].id;

  const { result, asked } = drive(seeded, "p1", {
    kind: "levelUp",
    characterId: "BP01-003",
    discardIds: [discard],
  });
  check("เลเวลอัป: Leader กลายเป็นการ์ด Level 1", result.state.boards.p1.leader?.card.id === "BP01-003");
  check(
    "เลเวลอัป: การ์ดเดิมอยู่ใต้ใบใหม่ ไม่ได้หายไป",
    result.state.boards.p1.leader?.under.map((c) => c.id).join() === "BP01-005",
    result.state.boards.p1.leader?.under.map((c) => c.id).join() ?? "-"
  );
  check("เลเวลอัป: ทิ้งการ์ดตามค่าเลเวล", result.state.boards.p1.trash.some((c) => c.id === discard));
  // BP01-003 prints "[Enter] / [Level up]" — two triggers on one effect, so
  // this also proves the levelUp half is reachable, not just the enter half.
  check("เอฟเฟคถามผู้เล่นระหว่างเลเวลอัป", asked.includes("BP01-003"), asked.join(","));
  check("ตอบตกลง -> ได้การ์ดจากกองทิ้งขึ้นมือ", result.state.boards.p1.hand.some((c) => c.id === "BP01-051"));
  check("ตอบตกลง -> การ์ดออกจากกองทิ้ง", !result.state.boards.p1.trash.some((c) => c.id === "BP01-051"));

  // The same step, answered "no", must leave the card where it was.
  const declined = drive(
    seeded,
    "p1",
    { kind: "levelUp", characterId: "BP01-003", discardIds: [discard] },
    () => ""
  );
  check(
    "ตอบปฏิเสธ -> การ์ดยังอยู่กองทิ้ง",
    declined.result.state.boards.p1.trash.some((c) => c.id === "BP01-051")
  );
  check("ตอบปฏิเสธ -> ไม่ขึ้นมือ", !declined.result.state.boards.p1.hand.some((c) => c.id === "BP01-051"));

  const wrongCost = step(seeded, "p1", { kind: "levelUp", characterId: "BP01-003", discardIds: [] });
  check("ทิ้งการ์ดไม่ครบ -> ถูกปฏิเสธ", wrongCost.error !== null, wrongCost.error ?? "");

  const skipLevel = step(seeded, "p1", { kind: "levelUp", characterId: "BP01-011", discardIds: [] });
  check("เลเวลอัปข้ามตัวละคร -> ถูกปฏิเสธ", skipLevel.error !== null, skipLevel.error ?? "");

  // Camellya is at Level 0 here, so her Level 2 card is two steps away.
  const jump = step(seeded, "p1", {
    kind: "levelUp",
    characterId: "BP01-001",
    discardIds: seeded.boards.p1.hand.slice(0, 2).map((c) => c.id),
  });
  check(
    "0 -> 2 ข้ามเลเวล -> ถูกปฏิเสธ",
    jump.error?.includes("one level at a time") === true,
    jump.error ?? ""
  );

  // Step up to 1 first, and the Level 2 card becomes legal.
  const stepped = drive(seeded, "p1", {
    kind: "levelUp",
    characterId: "BP01-003",
    discardIds: [discard],
  }).result.state;
  stepped.boards.p1.actionsTakenThisTurn = [];
  const next = step(stepped, "p1", {
    kind: "levelUp",
    characterId: "BP01-001",
    discardIds: stepped.boards.p1.hand.slice(0, 2).map((c) => c.id),
  });
  check("ขึ้นทีละเลเวล 0 -> 1 -> 2 ได้", next.error === null, next.error ?? "");
}

// --- Switch, and the pile a character becomes -------------------------------

{
  const s = drive(newMatch(), "p1", { kind: "startTurn" }).result.state;
  const back = s.boards.p1.back[0].card;
  const wasLeader = s.boards.p1.leader!.card;

  const { result } = drive(s, "p1", { kind: "switch", toCardId: back.id });
  check("สลับ Leader: ตัวหลังขึ้นมาเป็น Leader", result.state.boards.p1.leader?.card.id === back.id);
  check(
    "สลับ Leader: ตัวเดิมลงไปอยู่ข้างหลัง",
    result.state.boards.p1.back.some((slot) => slot.card.id === wasLeader.id)
  );
  check("สลับ Leader: ยังมี 3 ตัวบนสนาม", result.state.boards.p1.back.length === 2);
  check(
    "ตำแหน่งถูกอัปเดตตามที่ย้าย",
    result.state.boards.p1.leader?.position === "leader" &&
      result.state.boards.p1.back.every((slot) => slot.position === "back")
  );

  const twice = step(result.state, "p1", { kind: "switch", toCardId: back.id });
  check("สลับซ้ำในเทิร์นเดียวไม่ได้", twice.error !== null, twice.error ?? "");

  // A levelled-up character keeps their lower levels when they move.
  const levelled = drive(s, "p1", {
    kind: "levelUp",
    characterId: "BP01-003",
    discardIds: [s.boards.p1.hand[0].id],
  }).result.state;
  check("เลเวลอัปแล้วกองซ้อนสูงขึ้น", levelled.boards.p1.leader?.under.length === 1);

  const moved = drive(levelled, "p1", { kind: "switch", toCardId: back.id }).result.state;
  const camellya = moved.boards.p1.back.find((slot) => slot.card.id === "BP01-003");
  check(
    "สลับแล้วกองซ้อนย้ายไปทั้งกอง",
    camellya?.under.map((c) => c.id).join() === "BP01-005",
    camellya?.under.map((c) => c.id).join() ?? "หาไม่เจอ"
  );
}

// --- A character pile: every level in it is still in play -------------------

{
  // Camellya levelled 0 -> 1. BP01-005 (Level 0) has "[Leader] [Judgement] if
  // you won, take a {Basic attack} from the trash"; it sits UNDER BP01-003
  // now, and must still fire.
  let s = drive(newMatch(), "p1", { kind: "startTurn" }).result.state;
  s = drive(s, "p1", {
    kind: "levelUp",
    characterId: "BP01-003",
    discardIds: [s.boards.p1.hand[0].id],
  }).result.state;

  const leader = s.boards.p1.leader!;
  check(
    "กองซ้อน: ใบบนคือเลเวลปัจจุบัน ใบเก่าอยู่ใต้",
    leader.card.id === "BP01-003" && leader.under.map((c) => c.id).join() === "BP01-005",
    `บน=${leader.card.id} ล่าง=${leader.under.map((c) => c.id).join()}`
  );

  const sources = sourcesInPlay(s, "judgement").filter((src) => src.controllerId === "p1");
  check(
    "เอฟเฟคทำงานทุกใบในกอง ไม่ใช่แค่ใบบนสุด",
    sources.some((src) => src.card.id === "BP01-005") &&
      sources.some((src) => src.card.id === "BP01-003"),
    sources.map((src) => src.card.id).join(",")
  );
  check(
    "ใบที่อยู่ใต้ยังนับเป็นโซน leader",
    sources.filter((src) => src.card.id === "BP01-005").every((src) => src.zone === "leader")
  );

  // The buried Level 0 skill actually resolves.
  const won = structuredClone(s);
  won.lastBattleWinnerId = "p1";
  won.boards.p1.trash = [action("BP01-044")]; // a {Basic Attack}
  const handBefore = won.boards.p1.hand.length;
  const fired = resolveTrigger(won, "judgement", sourcesInPlay(won, "judgement"));
  check(
    "สกิลของใบที่ถูกซ้อนทับยังทำงานจริง",
    fired.state.boards.p1.hand.length === handBefore + 1,
    `hand ${handBefore} -> ${fired.state.boards.p1.hand.length}`
  );
}

// --- Returning a character takes that card only ----------------------------

{
  // BP01-001 is Camellya Level 2, "[Level up] return this card to the
  // Character deck". Level 0 -> 1 -> 2 and the Level 2 card bounces straight
  // back, leaving the character standing at Level 1.
  let s = drive(newMatch(), "p1", { kind: "startTurn" }).result.state;
  s = drive(s, "p1", {
    kind: "levelUp",
    characterId: "BP01-003",
    discardIds: [s.boards.p1.hand[0].id],
  }).result.state;
  s = drive(s, "p1", { kind: "endTurn" }).result.state;
  s = drive(s, "p2", { kind: "endTurn" }).result.state;
  s = drive(s, "p1", { kind: "startTurn" }).result.state;

  const poolBefore = s.boards.p1.characterPool.length;
  const { result } = drive(s, "p1", {
    kind: "levelUp",
    characterId: "BP01-001",
    discardIds: s.boards.p1.hand.slice(0, 2).map((c) => c.id),
  });

  const after = result.state.boards.p1;
  check(
    "ใบที่สั่ง return กลับเข้า pool",
    after.characterPool.some((c) => c.id === "BP01-001"),
    after.characterPool.map((c) => c.id).join(",")
  );
  check(
    "ตัวละครยังอยู่บนสนาม ไม่ได้หายไปทั้งกอง",
    after.leader !== null && after.leader.card.id === "BP01-003",
    after.leader ? after.leader.card.id : "ไม่มี Leader"
  );
  check(
    "ใบที่อยู่ใต้ไม่ถูกส่งกลับไปด้วย",
    after.leader?.under.map((c) => c.id).join() === "BP01-005",
    after.leader?.under.map((c) => c.id).join() ?? "-"
  );
  check(
    "pool เพิ่มขึ้นสุทธิ 0 ใบ (เอาไป 1 คืนมา 1)",
    after.characterPool.length === poolBefore,
    `${poolBefore} -> ${after.characterPool.length}`
  );
}

// --- Playing nothing, and giving up ----------------------------------------

{
  let s = newMatch();
  s.phase = "counter";
  s.boards.p1.hand = [action("BP01-044")];
  s.boards.p2.hand = []; // nothing to play

  check("มือว่าง -> ลงการ์ดไม่ได้", canCommitAnything(s, "p2") === false);
  check("ยังมีการ์ด -> ลงได้", canCommitAnything(s, "p1") === true);

  const stuck = step(s, "p2", { kind: "commit", cardId: "BP01-044" });
  check("ลงการ์ดที่ไม่มีในมือ -> ถูกปฏิเสธ", stuck.error !== null, stuck.error ?? "");

  const c1 = step(s, "p1", { kind: "commit", cardId: "BP01-044" });
  const c2 = step(c1.state, "p2", { kind: "pass" });
  check("ไม่ลงการ์ดได้ และนับว่าเลือกแล้ว", c2.error === null && c2.state.committed.p2 === true);
  check(
    "เลือกครบแล้วเปิดการ์ดได้",
    legalIntents(c2.state, "p1").includes("resolveCounter"),
    legalIntents(c2.state, "p1").join(",")
  );

  const { result } = drive(c2.state, "p1", { kind: "resolveCounter" });
  check("ฝ่ายที่ลงการ์ดฝ่ายเดียวชนะ", result.state.lastBattleWinnerId === "p1");
  check(
    "ดาเมจเข้าเต็มเพราะไม่มีอะไรมาปะทะ",
    result.state.boards.p2.life === 19,
    `${result.state.boards.p2.life}`
  );
  check("Action Area ของฝ่ายที่ไม่ลงว่างเปล่า", result.state.actionZone.p2.length === 0);

  // Neither side plays: nothing happens at all. The turn player may only skip
  // with nothing playable in hand, so p1's hand is emptied rather than simply
  // declining — see the rule-9 block further down.
  let quiet = newMatch();
  quiet.phase = "counter";
  quiet.boards.p1.hand = [];
  const q1 = step(quiet, "p1", { kind: "pass" });
  const q2 = step(q1.state, "p2", { kind: "pass" });
  const both = drive(q2.state, "p1", { kind: "resolveCounter" }).result;
  check("ไม่ลงทั้งคู่ -> ไม่มีการปะทะ", both.state.lastBattleWinnerId === null);
  check(
    "ไม่ลงทั้งคู่ -> ไม่มีใครเสียเลือด",
    both.state.boards.p1.life === 20 && both.state.boards.p2.life === 20
  );
  check("ไม่ลงทั้งคู่ -> ไม่มีคอมโบ", both.state.combo === null);
}

{
  const s = drive(newMatch(), "p1", { kind: "startTurn" }).result.state;
  const out = step(s, "p1", { kind: "concede" });
  check("ยอมแพ้ -> อีกฝ่ายชนะทันที", out.state.winnerId === "p2", `${out.state.winnerId}`);
  const after = step(out.state, "p2", { kind: "endTurn" });
  check("ยอมแพ้แล้วเล่นต่อไม่ได้", after.error === "The match is already over", after.error ?? "");
}

// --- The Action Phase stays open after its three moves are spent ----------
//
// Leaving it is the turn player's call (603.1.3): into the battle, or past it.
// Opening the Battle Phase by itself took the second choice away.

{
  let s = drive(newMatch(), "p1", { kind: "startTurn" }).result.state;
  s = drive(s, "p1", { kind: "charge", cardIds: [s.boards.p1.hand[0].id] }).result.state;
  check("ชาร์จแล้ว ยังอยู่เฟสหลัก", s.phase === "action", s.phase);

  s = drive(s, "p1", {
    kind: "levelUp",
    characterId: "BP01-003",
    discardIds: [s.boards.p1.hand[0].id],
  }).result.state;
  check("เลเวลอัปแล้ว ยังอยู่เฟสหลัก", s.phase === "action", s.phase);

  const spent = drive(s, "p1", { kind: "switch", toCardId: s.boards.p1.back[0].card.id }).result
    .state;
  check("ใช้แอ็กชันครบ 3 อย่าง -> ยังอยู่เฟสหลัก", spent.phase === "action", spent.phase);
  const legal = legalIntents(spent, "p1");
  check(
    "เลือกได้ทั้งเข้าเฟสประลองและข้าม",
    legal.includes("toBattle") && legal.includes("skipCounter"),
    legal.join(",")
  );
  check("ยังไม่มีใครลงคว่ำได้", !canCommit(spent, "p1") && !canCommit(spent, "p2"));

  const skipped = drive(spent, "p1", { kind: "skipCounter" }).result.state;
  check("ข้ามเฟสประลองได้ -> เฟสจบเทิร์น", skipped.phase === "end", skipped.phase);
  const battle = drive(spent, "p1", { kind: "toBattle" }).result.state;
  check("หรือเข้าเฟสประลอง -> ทั้งสองฝ่ายลงคว่ำได้", battle.phase === "counter" && canCommit(battle, "p1") && canCommit(battle, "p2"), battle.phase);
}

// --- Continuous sources activated during Counter affect that clash ----------

{
  // BP01-062 puts BP01-011 (Encore Lv.2) on an Encore and switches to it
  // DURING Counter. BP01-011's passive gives red Encore cards +1 attack, so
  // the BP01-062 already in the Action Area must hit for 4, not its printed
  // 3. This proves Counter triggers settle continuous effects before both
  // the colour/speed comparison and the final post-Judgement damage read.
  let s = drive(newMatch(), "p1", { kind: "startTurn" }).result.state;
  s.boards.p1.hand = [action("BP01-058")]; // green, so p2's red BP01-062 wins
  s.boards.p2.hand = [action("BP01-062")];
  s.boards.p2.competitionArea = [action("BP01-044"), action("BP01-044")];
  const lifeBefore = s.boards.p1.life;

  s = drive(s, "p1", { kind: "commit", cardId: "BP01-058" }).result.state;
  s = drive(s, "p2", { kind: "commit", cardId: "BP01-062" }).result.state;
  const resolved = drive(s, "p1", { kind: "resolveCounter" }).result;

  check(
    "BP01-062 -> BP01-011: Level 2 ลงสนามจริงระหว่าง Counter",
    resolved.state.boards.p2.leader?.card.id === "BP01-011",
    resolved.state.boards.p2.leader?.card.id ?? "-"
  );
  check(
    "BP01-062 ได้ +1 จาก BP01-011 ก่อนคิดดาเมจ",
    resolved.state.boards.p1.life === lifeBefore - 4,
    `${lifeBefore} -> ${resolved.state.boards.p1.life}`
  );
  check(
    "modifier ของ BP01-011 ยัง active หลัง Counter จบ",
    resolved.state.statModifiers.some(
      (modifier) => modifier.sourceCardId === "BP01-011" && modifier.stat === "attack"
    )
  );
}

// --- Combo cards fire [Combo], not [Battle] -------------------------------

{
  // BP01-062 is a red follow-up here, but its [Battle] effect belongs only
  // to the two cards initially revealed for the determining clash. Therefore
  // it deals ordinary follow-up damage without replacing Encore or switching
  // Leader, even though BP01-011 is available in the Character Pool.
  const s = newMatch();
  s.phase = "combo";
  s.turnPlayerId = "p1";
  s.combo = { playerId: "p1", unlimited: true, remaining: Infinity };
  s.boards.p1.leader = { position: "leader", card: character("BP01-015"), under: [] };
  s.boards.p1.characterPool = [character("BP01-011")];
  s.boards.p1.hand = [action("BP01-062")];
  s.boards.p1.competitionArea = [action("BP01-044"), action("BP01-044")];
  s.actionZone.p1 = [action("BP01-044")];
  const lifeBefore = s.boards.p2.life;

  const followUp = drive(s, "p1", { kind: "combo", cardId: "BP01-062" }).result;
  check(
    "BP01-062 เป็น follow-up -> [Battle] ไม่ Level up Encore",
    followUp.state.boards.p1.leader?.card.id === "BP01-015" &&
      followUp.state.boards.p1.characterPool.some((card) => card.id === "BP01-011"),
    `leader=${followUp.state.boards.p1.leader?.card.id} pool=${followUp.state.boards.p1.characterPool.map((card) => card.id).join()}`
  );
  check(
    "BP01-062 follow-up ยังทำดาเมจตามปกติ",
    followUp.state.boards.p2.life === lifeBefore - 3,
    `${lifeBefore} -> ${followUp.state.boards.p2.life}`
  );

  // Counter+Combo is explicit OR timing. Removing the implicit [Battle]
  // dispatch must not suppress BP01-061's printed [Combo] clause, or run it
  // twice. One restriction log proves the single Combo resolution.
  const dual = newMatch();
  dual.phase = "combo";
  dual.turnPlayerId = "p1";
  dual.combo = { playerId: "p1", unlimited: true, remaining: Infinity };
  dual.boards.p1.leader = { position: "leader", card: character("BP01-015"), under: [] };
  dual.boards.p1.hand = [action("BP01-061")];
  dual.actionZone.p1 = [action("BP01-044")];
  const dualOut = drive(dual, "p1", { kind: "combo", cardId: "BP01-061" }).result;
  check(
    "BP01-061 follow-up: [Combo] ยังทำงานครั้งเดียว",
    dualOut.state.turnLog.flags.p1?.includes("noCombo") === true &&
      dualOut.log.filter((line) => line.th.includes("noCombo")).length === 1,
    dualOut.log.map((line) => line.th).join(" | ")
  );
}

// --- "The first {Normal Attack}" is one card, not one printing ------------

{
  // Encore Lv.0's Leader Skill: once a turn, the first Encore {Normal Attack}
  // gains +2. With three copies of the same Heavy Attack comboed, each copy
  // used to find itself at the first copy's place in the turn log — they share
  // a printed id — and all three hit for 3. Reported from a bot match
  // (bug-local-1790395710563.json: three BP01-060 for 4 each under Lv.2).
  const s = newMatch();
  s.phase = "combo";
  s.turnPlayerId = "p1";
  s.combo = { playerId: "p1", unlimited: true, remaining: Infinity };
  s.boards.p1.leader = { position: "leader", card: character("BP01-015"), under: [] };
  s.boards.p1.hand = ["a", "b", "c"].map((copy) => ({ ...action("BP01-060"), uid: `p1-heavy-${copy}` }));
  s.actionZone.p1 = [action("BP01-044")];

  const hits: number[] = [];
  let board = s;
  for (let i = 0; i < 3; i += 1) {
    const before = board.boards.p2.life;
    board = drive(board, "p1", { kind: "combo", cardId: "BP01-060" }).result.state;
    hits.push(before - board.boards.p2.life);
  }
  check("Encore Lv.0: +2 เฉพาะ Normal Attack ใบแรก แม้เป็นการ์ดเลขเดียวกัน", hits.join() === "3,1,1", hits.join());
}

// --- The clash -------------------------------------------------------------

{
  // p1 plays red, p2 plays blue: blue beats red, so p2 should win and p1 takes 3.
  let s = structuredClone(game);
  s.boards.p1.hand = [action("BP01-044")]; // red, atk 1
  s.boards.p2.hand = [action("BP01-045")]; // blue, atk 3

  // The turn player opens the Counter Phase on purpose; cards go down only
  // once it is open. Committing no longer doubles as the way in.
  const opened = step(s, "p1", { kind: "toBattle" });
  check("กด Battle -> เข้าเฟส counter", opened.state.phase === "counter" && opened.error === null, opened.error ?? opened.state.phase);

  const c1 = step(opened.state, "p1", { kind: "commit", cardId: "BP01-044" });
  check("ลงการ์ดคว่ำ -> ยังอยู่เฟส counter", c1.state.phase === "counter" && c1.error === null, c1.error ?? "");
  check("การ์ดคว่ำออกจากมือ", c1.state.boards.p1.hand.length === 0);

  const early = step(c1.state, "p1", { kind: "resolveCounter" });
  check("อีกฝ่ายยังไม่ลง -> เปิดไม่ได้", early.error !== null, early.error ?? "");

  const c2 = step(c1.state, "p2", { kind: "commit", cardId: "BP01-045" });
  const twice = step(c2.state, "p2", { kind: "commit", cardId: "BP01-045" });
  check("ลงการ์ดคว่ำซ้ำ -> ถูกปฏิเสธ", twice.error !== null, twice.error ?? "");

  const { result } = drive(c2.state, "p1", { kind: "resolveCounter" });
  check("ฟ้าชนะแดง", result.state.lastBattleWinnerId === "p2", `${result.state.lastBattleWinnerId}`);
  check("ผู้แพ้เสียเลือดเท่าแอทแทคผู้ชนะ", result.state.boards.p1.life === 17, `${result.state.boards.p1.life}`);
  check("บันทึกดาเมจลง turnLog", result.state.turnLog.damageTaken.p1 === 3);
  check("การ์ดที่เปิดอยู่ใน Action Zone", result.state.actionZone.p1[0]?.id === "BP01-044");
  check("บันทึกการ์ดที่เล่นลง turnLog", result.state.turnLog.cardsPlayed.p2?.length === 1);
  check("เปิดเสร็จเข้าขั้นคอมโบ", result.state.phase === "combo");
  check(
    "ผู้ชนะด้วยฟ้าได้คอมโบตาม Follow{x} เท่านั้น",
    result.state.combo?.playerId === "p2" && result.state.combo.unlimited === false,
    JSON.stringify(result.state.combo)
  );
  game = result.state;
}

// --- Combo Step ------------------------------------------------------------

{
  const loser = step(game, "p1", { kind: "combo", cardId: "BP01-044" });
  check("ผู้แพ้คอมโบไม่ได้", loser.error === "You did not win the clash", loser.error ?? "");

  // Blue's Follow{x} is 0 here, so p2 has no follow-ups either.
  let s = structuredClone(game);
  s.boards.p2.hand = [action("BP01-044")];
  const noneLeft = step(s, "p2", { kind: "combo", cardId: "BP01-044" });
  check("ไม่มีสิทธิ์ follow-up เหลือ -> คอมโบไม่ได้", noneLeft.error === "No follow-ups left", noneLeft.error ?? "");

  // A red win grants unlimited combos — check one actually lands damage.
  const red = structuredClone(s);
  red.combo = { playerId: "p2", unlimited: true, remaining: Infinity };
  const life = red.boards.p1.life;
  const zoneBefore = red.actionZone.p2.length;
  const { result } = drive(red, "p2", { kind: "combo", cardId: "BP01-044" });
  check(
    "คอมโบ: การ์ดต่อท้ายใน Action Zone",
    result.state.actionZone.p2.length === zoneBefore + 1 &&
      result.state.actionZone.p2.at(-1)?.id === "BP01-044",
    `${result.state.actionZone.p2.length}`
  );
  check("คอมโบ: โจมตีต่อเนื่องเข้าเป้า", result.state.boards.p1.life === life - 1, `${result.state.boards.p1.life}`);
  check("คอมโบไม่จำกัด -> ยังคอมโบต่อได้", result.state.combo?.unlimited === true);

  // A card that forbade combos this turn must actually stop one.
  const blocked = structuredClone(red);
  blocked.turnLog.flags.p2 = ["noCombo"];
  const stopped = step(blocked, "p2", { kind: "combo", cardId: "BP01-044" });
  check("ธง noCombo ห้ามคอมโบจริง", stopped.error?.includes("stops you comboing") === true, stopped.error ?? "");

  // A restriction prevents another follow-up, not the only exits from the
  // phase. This is intentionally p2 (the non-turn player) winning: that is
  // the case the old turn gate hid from the UI and made BP01-061 look like a
  // deadlock.
  for (const flag of ["noCombo", "noFollowUp"]) {
    const locked = structuredClone(red);
    locked.turnPlayerId = "p1";
    locked.combo = { playerId: "p2", unlimited: true, remaining: Infinity };
    locked.turnLog.flags.p2 = [flag];
    const choices = legalIntents(locked, "p2");
    check(
      `${flag}: เจ้าของคอมโบที่ไม่ใช่เจ้าของเทิร์นยังมีทางออก`,
      !choices.includes("combo") && choices.includes("passCombo") && choices.includes("endTurn"),
      choices.join(",")
    );
    check(`${flag}: เจ้าของเทิร์นไม่มีสิทธิ์จบแทน`, legalIntents(locked, "p1").length === 0);
    const ended = step(locked, "p2", { kind: "endTurn" });
    check(`${flag}: กด End แล้วเกมเดินต่อ`, ended.error === null && ended.state.phase === "draw", ended.error ?? ended.state.phase);
  }

  const passed = step(game, "p2", { kind: "passCombo" });
  check("จบขั้นคอมโบ -> เข้าเฟสจบเทิร์น", passed.state.phase === "end" && passed.error === null);
  game = passed.state;
}

// --- End Phase and passing the turn ----------------------------------------

{
  let s = structuredClone(game);
  s.boards.p1.hand = Array.from({ length: 10 }, () => action("BP01-044"));
  const { result } = drive(s, "p1", { kind: "endTurn" });
  check("จบเทิร์น: ทิ้งการ์ดให้เหลือ 8", result.state.boards.p1.hand.length === HAND_LIMIT, `${result.state.boards.p1.hand.length}`);
  check("จบเทิร์น: ล้าง Action Area ลงกองทิ้ง", result.state.actionZone.p1.length === 0);
  check("จบเทิร์น: สลับผู้เล่น", result.state.turnPlayerId === "p2", result.state.turnPlayerId);
  check("จบเทิร์น: เลขเทิร์นเดินหน้า", result.state.turnNumber === 2);
  check("จบเทิร์น: กลับไปเฟสจั่ว", result.state.phase === "draw");
  game = result.state;

  // Mixed cards: which ones go is the turn player's pick, not the engine's.
  const mixed = structuredClone(s);
  mixed.boards.p1.hand = [
    ...Array.from({ length: 5 }, () => action("BP01-044")),
    ...Array.from({ length: 5 }, () => action("BP01-045")),
  ];
  const asked = step(mixed, "p1", { kind: "endTurn" });
  check(
    "มือเกิน 8: ถามให้เลือกทิ้ง 2 ใบ",
    asked.pending?.kind === "pickCard" && asked.pending.playerId === "p1" && asked.pending.min === 2,
    JSON.stringify(asked.pending?.prompt)
  );
  const blues = asked.pending!.options.filter((o) => o.cardId === "BP01-045").slice(0, 2);
  const chosen = step(mixed, "p1", { kind: "endTurn" }, [blues.map((o) => o.value)]);
  check(
    "มือเกิน 8: ทิ้งใบที่เลือก",
    chosen.state.boards.p1.hand.filter((c) => c.id === "BP01-045").length === 3 &&
      chosen.state.boards.p1.hand.length === HAND_LIMIT
  );

  const notYours = step(game, "p1", { kind: "endTurn" });
  check("จบเทิร์นแทนคนอื่นไม่ได้", notYours.error === "It is not your turn", notYours.error ?? "");

  const second = drive(game, "p2", { kind: "startTurn" });
  check("เทิร์นถัดไปจั่ว 2 ใบ", second.result.state.boards.p2.hand.length === game.boards.p2.hand.length + 2);
  check("ล้างบันทึกรายเทิร์น", Object.keys(second.result.state.turnLog.damageTaken).length === 0);
  check("ล้างจำนวนแอ็กชันที่ใช้ไป", second.result.state.boards.p1.actionsTakenThisTurn.length === 0);
}

// --- Win condition ---------------------------------------------------------

{
  let s = newMatch();
  s.phase = "counter";
  s.boards.p1.life = 2;
  s.boards.p1.hand = [action("BP01-044")]; // red atk 1
  s.boards.p2.hand = [action("BP01-045")]; // blue atk 3
  const c1 = step(s, "p1", { kind: "commit", cardId: "BP01-044" });
  const c2 = step(c1.state, "p2", { kind: "commit", cardId: "BP01-045" });
  const { result } = drive(c2.state, "p1", { kind: "resolveCounter" });
  check("เลือดหมด -> ประกาศผู้ชนะ", result.state.winnerId === "p2", `${result.state.winnerId}`);

  const after = step(result.state, "p2", { kind: "passCombo" });
  check("จบเกมแล้วสั่งอะไรต่อไม่ได้", after.error === "The match is already over", after.error ?? "");
}

// --- [Counter] sees the card actually being played --------------------------

{
  // BP01-010 Shorekeeper is "[Leader] [Counter] if you counter with a green
  // card, you may reveal the top card and take it". The Counter Phase happens
  // for both sides, so this fires for whoever laid the green card down — and
  // it has to read the card revealed THIS phase, not the colour of the
  // previous battle, which is what raising [Counter] before the reveal did.
  const shorekeeper = ["BP01-010", "BP01-008", "BP01-024", "BP01-027"].map(character);
  const green = requireCard("BP01-058"); // Shorekeeper, green, cost 0
  check(
    "การ์ดที่ใช้ทดสอบเป็นสีเขียวจริง",
    green.type === "action" && green.color === "green",
    green.type === "action" ? green.color : green.type
  );

  const s = createMatch({
    matchId: "counter-timing",
    startingPlayerId: "p1",
    players: [
      { playerId: "p1", characterDeck: shorekeeper, actionDeck: deck(["BP01-052"]) },
      { playerId: "p2", characterDeck: ENCORE.map(character), actionDeck: deck(P2_DECK) },
    ],
  });
  s.phase = "counter";
  s.boards.p1.hand = [action("BP01-058")]; // green
  s.boards.p2.hand = [action("BP01-044")]; // red

  const c1 = step(s, "p1", { kind: "commit", cardId: "BP01-058" });
  const c2 = step(c1.state, "p2", { kind: "commit", cardId: "BP01-044" });

  const first = step(c2.state, "p1", { kind: "resolveCounter" });
  check(
    "[Counter] ถามหลังเปิดการ์ด ไม่ใช่ก่อน",
    first.pending?.cardId === "BP01-010",
    first.pending ? first.pending.cardId : "ไม่ถามเลย"
  );
  check("ถามเจ้าของการ์ดที่ลงสีเขียว", first.pending?.playerId === "p1", first.pending?.playerId ?? "-");

  const { result } = drive(c2.state, "p1", { kind: "resolveCounter" });
  check("ตอบแล้วจบเฟสได้", result.pending === null && result.error === null, result.error ?? "");
  check(
    "ตอบตกลง -> ได้การ์ดบนสุดขึ้นมือ",
    result.state.boards.p1.hand.length === 1,
    `hand=${result.state.boards.p1.hand.length}`
  );
  check(
    "ระหว่างถาม: คำถามแนบการ์ดที่เปิดมาให้คนตอบเห็น",
    Boolean(first.pending?.revealed?.some((r) => r.kind === "revealTop" && r.cards[0]?.id === "BP01-052"))
  );
  const shown = result.state.reveals.find((r) => r.kind === "revealTop");
  check(
    "เปิดการ์ดแล้วนำขึ้นมือ -> ทั้งสองฝ่ายเห็น จนจบเฟส",
    shown?.playerId === "p1" && shown.taken === 1 && shown.phase === result.state.phase,
    JSON.stringify(shown)
  );
  check(
    "log บอกชื่อการ์ดที่เปิด",
    result.log.some((l) => l.en.includes("reveals the top 1") && l.en.includes(action("BP01-052").name))
  );
  check("ไม่ใช่ฝ่ายเจ้าของ ก็ยังเห็นการ์ดที่เปิด", viewFor(result.state, "p2").reveals.length > 0);
}

{
  // Both sides reveal in the same [Counter]: BP01-018 (turn player) first,
  // then BP01-010. The second player's question carries only their own card,
  // not the two the turn player turned up just before.
  const s = createMatch({
    matchId: "counter-two-reveals",
    startingPlayerId: "p1",
    players: [
      { playerId: "p1", characterDeck: ENCORE.map(character), actionDeck: deck(["BP01-052"]) },
      { playerId: "p2", characterDeck: ENCORE.map(character), actionDeck: deck(["BP01-044"]) },
    ],
  });
  s.boards.p1.leader = { position: "leader", card: character("BP01-018"), under: [] };
  s.boards.p2.leader = { position: "leader", card: character("BP01-010"), under: [] };
  s.phase = "counter";
  s.boards.p1.hand = [action("BP01-058")];
  s.boards.p2.hand = [action("BP01-058")];
  const c1 = step(s, "p1", { kind: "commit", cardId: "BP01-058" });
  const c2 = step(c1.state, "p2", { kind: "commit", cardId: "BP01-058" });
  check("เปิดสองฝั่ง: ลงการ์ดเขียวได้ทั้งคู่", c1.error === null && c2.error === null, `${c1.error} ${c2.error}`);

  const first = step(c2.state, "p1", { kind: "resolveCounter" });
  check("BP01-018 ถามเจ้าของเทิร์นก่อน", first.pending?.playerId === "p1", first.pending?.cardId ?? "-");
  const second = step(c2.state, "p1", { kind: "resolveCounter" }, ["2"]);
  check("แล้วถาม BP01-010 ของอีกฝ่าย", second.pending?.playerId === "p2", second.pending?.cardId ?? "-");
  const shownToP2 = second.pending?.revealed ?? [];
  check(
    "คำถามของอีกฝ่ายแนบแค่การ์ดที่ตัวเองเปิด ไม่ติดของเจ้าของเทิร์น",
    shownToP2.length === 1 && shownToP2[0].playerId === "p2" && shownToP2[0].cards.length === 1,
    JSON.stringify(shownToP2.map((r) => [r.playerId, r.cards.length]))
  );
  const done = step(c2.state, "p1", { kind: "resolveCounter" }, ["2", true]);
  check(
    "จบแล้วทั้งสองฝั่งเห็นการ์ดที่เปิดของทั้งคู่",
    done.state.reveals.filter((r) => r.kind === "revealTop").map((r) => r.playerId).join(",") === "p1,p2",
    done.error ?? ""
  );
}

{
  // Two copies of one card in the same Combo Step: SD02-011 "[Combo] 3+ cards
  // in your Action Area -> this card +3". Each copy hits for 5+3 = 8. The
  // buff used to name the printed card, so the second copy also picked up
  // the first one's +3 and hit for 11.
  const s = createMatch({
    matchId: "self-buff-copies",
    startingPlayerId: "p1",
    skipMulligan: true,
    players: [
      { playerId: "p1", characterDeck: ENCORE.map(character), actionDeck: deck(["SD02-011", "BP01-044"]) },
      { playerId: "p2", characterDeck: CAMELLYA.map(character), actionDeck: deck(P2_DECK) },
    ],
  });
  const p1 = s.boards.p1;
  const jinshiAt = p1.back.findIndex((slot) => slot.card.id === "BP01-030");
  const jinshi = p1.back[jinshiAt];
  p1.back[jinshiAt] = { ...p1.leader!, position: "back" };
  p1.leader = { ...jinshi, position: "leader" };
  const pool = [...p1.hand, ...p1.actionDeck];
  const copies = pool.filter((c) => c.id === "SD02-011").slice(0, 2);
  const fillers = pool.filter((c) => c.id === "BP01-044").slice(0, 8);
  check("การ์ดแต่ละใบมี uid ของตัวเอง", copies.length === 2 && copies[0].uid !== copies[1].uid && Boolean(copies[0].uid));
  p1.hand = copies;
  p1.competitionArea = fillers.slice(2);
  s.actionZone.p1 = fillers.slice(0, 2);
  s.phase = "combo";
  s.combo = { playerId: "p1", unlimited: true, remaining: Infinity };

  const first = drive(s, "p1", { kind: "combo", cardId: "SD02-011" }).result;
  const hit1 = 20 - first.state.boards.p2.life;
  const second = drive(first.state, "p1", { kind: "combo", cardId: "SD02-011" }).result;
  const hit2 = first.state.boards.p2.life - second.state.boards.p2.life;
  check("SD02-011 ใบแรก -> 8", hit1 === 8, `${hit1} ${first.error ?? ""}`);
  check("SD02-011 ใบที่สอง -> 8 ไม่ใช่ 11 (บัฟไม่ซ้อนข้ามใบ)", hit2 === 8, `${hit2} ${second.error ?? ""}`);
}

// --- The published turn order ----------------------------------------------
//
// Four rules taken from the official rules page, each of which the engine got
// wrong at some point:
//   * skills resolve turn player first, then the other player
//   * Judgment skills resolve BEFORE the damage lands
//   * costs are paid when a card is turned up, not when it is laid down
//   * a red win chains red cards only

{
  const s = newMatch();
  const order = sourcesInPlay(s, "judgement").map((source) => source.controllerId);
  const firstOther = order.findIndex((id) => id !== s.turnPlayerId);
  check(
    "สกิลทำงานเรียงจากเจ้าของเทิร์นก่อน",
    order[0] === s.turnPlayerId &&
      (firstOther < 0 || !order.slice(firstOther).includes(s.turnPlayerId)),
    order.join(",")
  );

  // Turn the turn over and the order follows it.
  const flipped = structuredClone(s);
  flipped.turnPlayerId = "p2";
  check(
    "สลับเทิร์นแล้วลำดับสลับตาม",
    sourcesInPlay(flipped, "judgement")[0]?.controllerId === "p2",
    sourcesInPlay(flipped, "judgement")[0]?.controllerId ?? "-"
  );
}

{
  // BP01-047 is "[Judgement] if you win, draw a card". Its controller must
  // still be on full Life when it resolves: the damage has not landed yet.
  let s = newMatch();
  s.phase = "counter";
  s.boards.p1.hand = [action("BP01-045")]; // blue, atk 3
  s.boards.p2.hand = [action("BP01-044")]; // red, atk 1 — blue beats red
  const c1 = step(s, "p1", { kind: "commit", cardId: "BP01-045" });
  const c2 = step(c1.state, "p2", { kind: "commit", cardId: "BP01-044" });
  const { result } = drive(c2.state, "p1", { kind: "resolveCounter" });

  const lines = result.log;
  const judgementAt = lines.findIndex((line) => line.th.includes("ชนะการปะทะ"));
  const damageAt = lines.findIndex((line) => line.th.includes("เสีย "));
  check(
    "ตัดสินผลแพ้ชนะก่อน แล้วค่อยลงดาเมจ",
    judgementAt >= 0 && damageAt > judgementAt,
    lines.map((l) => l.th).join(" | ")
  );
  check("ดาเมจเข้าจริงหลังจากนั้น", result.state.boards.p2.life === 17, `${result.state.boards.p2.life}`);
}

{
  // A red win chains red cards only.
  let s = newMatch();
  s.phase = "combo";
  s.combo = { playerId: "p1", unlimited: true, remaining: Infinity };
  s.boards.p1.hand = [action("BP01-045"), action("BP01-044")]; // blue, red
  s.boards.p1.competitionArea = [action("BP01-044"), action("BP01-044")];

  const blue = step(s, "p1", { kind: "combo", cardId: "BP01-045" });
  check("ชนะด้วยแดง -> ต่อด้วยการ์ดที่ไม่ใช่แดงไม่ได้", blue.error !== null, blue.error ?? "");

  const red = drive(s, "p1", { kind: "combo", cardId: "BP01-044" });
  check("ต่อด้วยการ์ดแดงได้", red.result.error === null, red.result.error ?? "");

  // A Follow{x} window is red-only in the same way — the colour rule is about
  // the follow-up card itself, not about where the right to chain came from.
  const follow = structuredClone(s);
  follow.combo = { playerId: "p1", unlimited: false, remaining: 2 };
  const notRed = step(follow, "p1", { kind: "combo", cardId: "BP01-045" });
  check("สิทธิ์จาก Follow{x} ก็ต้องเป็นการ์ดแดงเหมือนกัน", notRed.error !== null, notRed.error ?? "");
  const followRed = drive(follow, "p1", { kind: "combo", cardId: "BP01-044" });
  check("Follow{x} ต่อด้วยแดงได้", followRed.result.error === null, followRed.result.error ?? "");
  check(
    "และหักสิทธิ์ไป 1",
    followRed.result.state.combo?.remaining === 1,
    `${followRed.result.state.combo?.remaining}`
  );

  // Spend the rest and the window closes. This is what caught the decrement
  // writing to a stale copy of the state, which made Follow{x} unlimited.
  let spending = followRed.result.state;
  spending.boards.p1.hand = [action("BP01-044"), action("BP01-044")];
  spending.boards.p1.competitionArea = [action("BP01-044"), action("BP01-044")];
  const second = drive(spending, "p1", { kind: "combo", cardId: "BP01-044" }).result;
  check("ใช้สิทธิ์ที่สอง -> เหลือ 0", second.state.combo?.remaining === 0, `${second.state.combo?.remaining}`);
  const third = step(second.state, "p1", { kind: "combo", cardId: "BP01-044" });
  check("สิทธิ์หมดแล้ว -> ต่อไม่ได้", third.error === "No follow-ups left", third.error ?? "");
}

// --- Hidden information ----------------------------------------------------

{
  const s = newMatch();
  const view = viewFor(s, "p1");
  check("มุมมองผู้เล่น: เห็นมือตัวเอง", view.boards.p1.hand.length === 5);
  // Hidden, but still counted: how many cards someone holds is public.
  check(
    "มุมมองผู้เล่น: มือฝ่ายตรงข้ามเป็นการ์ดคว่ำ",
    view.boards.p2.hand.length === 5 &&
      view.boards.p2.hand.every((card) => card.id.startsWith(HIDDEN_CARD_ID)),
    view.boards.p2.hand.map((card) => card.id).join(",")
  );
  check(
    "มุมมองผู้เล่น: ไม่เห็นชื่อการ์ดในมือฝ่ายตรงข้าม",
    view.boards.p2.hand.every((card) => card.name === "")
  );
  check(
    "มุมมองผู้เล่น: เด็คฝ่ายตรงข้ามนับได้แต่ดูไม่ได้",
    view.boards.p2.actionDeck.length === s.boards.p2.actionDeck.length &&
      view.boards.p2.actionDeck.every((card) => card.id.startsWith(HIDDEN_CARD_ID))
  );
  check("มุมมองผู้เล่น: ของจริงไม่ถูกแก้", s.boards.p2.hand.length === 5);
  check(
    "มุมมองผู้เล่น: มือตัวเองยังเป็นการ์ดจริง",
    view.boards.p1.hand.every((card) => !card.id.startsWith(HIDDEN_CARD_ID))
  );
}

// การ์ดที่คว่ำไว้ต้องเห็นว่า "มี" แต่ไม่เห็นว่าเป็นใบไหน
{
  let s = newMatch();
  s = step(s, "p1", { kind: "startTurn" }).state;
  const committed = s.boards.p1.hand[0];
  s = step(s, "p1", { kind: "toBattle" }).state;
  s = step(s, "p1", { kind: "commit", cardId: committed.id }).state;

  const mine = viewFor(s, "p1");
  const theirs = viewFor(s, "p2");
  check("การ์ดคว่ำ: เจ้าของเห็นว่าเป็นใบไหน", mine.facedown.p1?.id === committed.id);
  check(
    "การ์ดคว่ำ: อีกฝ่ายเห็นว่ามีการ์ดคว่ำ แต่ไม่รู้ว่าใบไหน",
    theirs.facedown.p1?.id.startsWith(HIDDEN_CARD_ID) === true,
    String(theirs.facedown.p1?.id)
  );
}

// --- What the UI may offer -------------------------------------------------

{
  const s = newMatch();
  check("เฟสจั่ว: สั่งได้แค่เริ่มเทิร์น", legalIntents(s, "p1").join(",") === "startTurn");
  check("ไม่ใช่เทิร์นตัวเอง: สั่งอะไรไม่ได้", legalIntents(s, "p2").length === 0);

  const started = drive(s, "p1", { kind: "startTurn" }).result.state;
  const kinds = legalIntents(started, "p1");
  check(
    "เฟสแอ็กชัน: ไปเฟสประลองได้ และเหลือแอ็กชันครบ 3 แบบ",
    kinds.includes("toBattle") && kinds.includes("charge") && kinds.includes("levelUp") && kinds.includes("switch"),
    kinds.join(",")
  );
  check("เฟสแอ็กชัน: ยังลงการ์ดคว่ำไม่ได้", !kinds.includes("commit"), kinds.join(","));
}

// --- Continuous effects must not DO anything --------------------------------
//
// recomputeContinuous throws away everything continuous effects produced and
// rebuilds it from the board, which is what makes it safe to call whenever
// anything moves. That only holds while continuous effects are limited to
// producing things. A one-shot in that list — deal 1 damage, draw a card —
// fires again on every rebuild, which is every level up, charge and switch
// for the rest of the game.
//
// This caught a real bug: "[Leader] [Counter] deal 1 damage" was classified
// as continuous because `leader` came first in its condition, so after one
// red counter the opponent quietly bled a point per board change until the
// game ended with life below zero.

{
  // Jinshi leads: BP01-030 Lv.0 is "[Leader] [Counter] if you counter with a
  // red card, deal 1 damage", BP01-029 Lv.1 "[Leader] [Judgement] if you win
  // with a red card, deal 2".
  const jinshi = ["BP01-030", "BP01-029", "BP01-024", "BP01-027"].map(character);
  let s = createMatch({
    matchId: "continuous-idempotence",
    startingPlayerId: "p1",
    players: [
      { playerId: "p1", characterDeck: jinshi, actionDeck: deck(["BP01-044"]) },
      { playerId: "p2", characterDeck: ENCORE.map(character), actionDeck: deck(P2_DECK) },
    ],
  });
  s.phase = "counter";
  s.boards.p1.hand = [action("BP01-044")]; // red
  s.boards.p2.hand = [action("BP01-052")];

  s = step(s, "p1", { kind: "commit", cardId: "BP01-044" }).state;
  s = step(s, "p2", { kind: "commit", cardId: "BP01-052" }).state;
  const { result } = drive(s, "p1", { kind: "resolveCounter" });
  s = result.state;

  const afterClash = s.boards.p2.life;
  check("ปะทะจบแล้วเลือดลดลงจริง", afterClash < 20, `20 -> ${afterClash}`);

  // The clash is over and lastBattle still says "p1 countered with red",
  // which is exactly the state that used to keep paying out.
  let rebuilt = s;
  for (let i = 0; i < 10; i += 1) rebuilt = recomputeContinuous(rebuilt).state;
  check(
    "คำนวณเอฟเฟคต่อเนื่องซ้ำ 10 รอบ เลือดไม่ขยับ",
    rebuilt.boards.p2.life === afterClash && rebuilt.boards.p1.life === s.boards.p1.life,
    `p2 ${afterClash} -> ${rebuilt.boards.p2.life}`
  );
  check(
    "และไม่มีใครถูกจั่วการ์ดเพิ่ม",
    rebuilt.boards.p1.hand.length === s.boards.p1.hand.length &&
      rebuilt.boards.p2.hand.length === s.boards.p2.hand.length
  );

  // The contract in one assertion: a second rebuild changes nothing a first
  // one did not.
  const once = recomputeContinuous(s).state;
  const twice = recomputeContinuous(once).state;
  check("คำนวณสองรอบได้ผลเท่ากับรอบเดียว", JSON.stringify(once) === JSON.stringify(twice));

  // The fix must not have silenced these abilities instead — they still have
  // to fire once, through their own trigger. Two separate hits land here: the
  // [Counter] ability, then the clash itself.
  const hits = result.log.filter((line) => line.th.includes("p2 เสีย"));
  check(
    "เอฟเฟค [Counter] ยังทำงานตอนเทรกเกอร์จริง ไม่ได้ถูกปิดไปด้วย",
    hits.length === 2,
    hits.map((l) => l.th).join(" | ")
  );
}

// แอ็กชันที่ไม่ใช่การโจมตี ต้องไม่ทำให้ใครเสียเลือด
{
  let s = newMatch();
  s = step(s, "p1", { kind: "startTurn" }).state;
  const before = { p1: s.boards.p1.life, p2: s.boards.p2.life };

  // Charge and Level Up both rebuild the continuous layer. Neither is an
  // attack, so nobody may lose life across them.
  const charged = step(s, "p1", { kind: "charge", cardIds: [s.boards.p1.hand[0].id] });
  s = charged.error ? s : charged.state;
  const target = s.boards.p1.characterPool.find((c) => c.level === 1);
  if (target) {
    const levelled = step(s, "p1", {
      kind: "levelUp",
      characterId: target.id,
      discardIds: [s.boards.p1.hand[0].id],
    });
    s = levelled.error ? s : levelled.state;
  }

  check(
    "ชาร์จ/เลเวลอัป ไม่ทำให้ใครเสียเลือด",
    s.boards.p1.life === before.p1 && s.boards.p2.life === before.p2,
    `p1 ${before.p1}->${s.boards.p1.life}  p2 ${before.p2}->${s.boards.p2.life}`
  );
}


// --- "[Counter] if you counter with X" reads YOUR card, this clash ----------
//
// BP01-030 Jinshi Lv.0: "[Leader] [Counter] if you counter with a red card,
// deal 1 damage". The Counter Phase happens for both sides, so the ability is
// raised for both — but the card it asks about is the controller's own, and
// only the one revealed right now. Playing no card means countering with
// nothing, however red the card you played last turn was.

{
  const jinshi = ["BP01-030", "BP01-029", "BP01-024", "BP01-027"].map(character);
  let s = createMatch({
    matchId: "counter-colour",
    startingPlayerId: "p1",
    players: [
      { playerId: "p1", characterDeck: jinshi, actionDeck: deck(["BP01-044"]) },
      { playerId: "p2", characterDeck: ENCORE.map(character), actionDeck: deck(["BP01-044"]) },
    ],
  });
  s.phase = "counter";
  s.boards.p1.hand = [action("BP01-044")]; // red
  s.boards.p2.hand = [action("BP01-045")]; // blue

  s = step(s, "p1", { kind: "commit", cardId: "BP01-044" }).state;
  s = step(s, "p2", { kind: "commit", cardId: "BP01-045" }).state;
  const first = drive(s, "p1", { kind: "resolveCounter" }).result;
  s = first.state;
  check(
    "counter ด้วยแดงเอง -> เอฟเฟคทำงาน",
    first.log.some((line) => line.th.includes("p2 เสีย 1 จาก Jinshi")),
    first.log.filter((line) => line.th.includes("เสีย")).map((l) => l.th).join(" | ")
  );

  // Round two: p1 lays nothing down, p2 counters with red. p1's Jinshi must
  // stay quiet — p1 countered with nothing at all.
  s = step(s, "p1", { kind: "passCombo" }).state;
  s = step(s, "p1", { kind: "endTurn" }).state;
  s = step(s, "p2", { kind: "startTurn" }).state;
  s.boards.p2.hand = [action("BP01-044")]; // red
  s = step(s, "p2", { kind: "commit", cardId: "BP01-044" }).state;
  s = step(s, "p1", { kind: "pass" }).state;

  const before = s.boards.p2.life;
  const second = drive(s, "p2", { kind: "resolveCounter" }).result;
  check(
    "ไม่ได้ลงการ์ด แต่อีกฝ่ายลงแดง -> Jinshi ของเราต้องไม่ทำงาน",
    // Was checking the English phrase against Thai-only log text, so this
    // always passed regardless — .th is the substring that's actually there.
    !second.log.some((line) => line.th.includes("จาก Jinshi")),
    second.log.filter((line) => line.th.includes("เสีย")).map((l) => l.th).join(" | ")
  );
  check(
    "และอีกฝ่ายต้องไม่เสียเลือดจากเอฟเฟคของเรา",
    second.state.boards.p2.life === before,
    `p2 ${before} -> ${second.state.boards.p2.life}`
  );
}

// --- The log says what took the Life, and which card ------------------------

{
  const jinshi = ["BP01-030", "BP01-029", "BP01-024", "BP01-027"].map(character);
  let s = createMatch({
    matchId: "damage-source",
    startingPlayerId: "p1",
    players: [
      { playerId: "p1", characterDeck: jinshi, actionDeck: deck(["BP01-044"]) },
      { playerId: "p2", characterDeck: ENCORE.map(character), actionDeck: deck(P2_DECK) },
    ],
  });
  s.phase = "counter";
  s.boards.p1.hand = [action("BP01-044")];
  s.boards.p2.hand = [action("BP01-052")];
  s = step(s, "p1", { kind: "commit", cardId: "BP01-044" }).state;
  s = step(s, "p2", { kind: "commit", cardId: "BP01-052" }).state;
  const out = drive(s, "p1", { kind: "resolveCounter" }).result;

  const hits = out.log.filter((line) => line.th.includes(" เสีย "));
  const hitTexts = hits.map((l) => l.th);
  check("มีบรรทัดดาเมจอย่างน้อย 2 บรรทัด", hits.length >= 2, hitTexts.join(" | "));
  check(
    "ทุกบรรทัดบอกว่ามาจากการ์ดใบไหน",
    hitTexts.every((text) => / จาก .+ \[[A-Z]{2}\d{2}-\d{3}\] /.test(text)),
    hitTexts.join(" | ")
  );
  check(
    "ดาเมจจากเอฟเฟคบอกชื่อตัวละคร",
    hitTexts.some((text) => text.includes("จาก Jinshi [BP01-030]")),
    hitTexts.join(" | ")
  );
  check(
    "ดาเมจจากการปะทะบอกชื่อการ์ดที่ชนะ",
    hitTexts.some((text) => /จาก .+ \[BP01-0(44|52)\]/.test(text)),
    hitTexts.join(" | ")
  );
}

// --- What the character menu is allowed to offer ---------------------------
//
// The menu on the board asks these two rather than working the rules out for
// itself, so anything they say yes to has to be a move the engine will
// actually accept — and anything it would refuse must never be offered.

{
  const s = drive(newMatch(), "p1", { kind: "startTurn" }).result.state;
  const leader = s.boards.p1.leader!;

  const onLeader = levelUpOptions(s, "p1", leader.card.id);
  check(
    "Lv.0 -> เสนอเฉพาะการ์ด Lv.1 ของตัวเอง",
    onLeader.map((c) => c.id).join() === "BP01-003",
    onLeader.map((c) => `${c.id}:${c.level}`).join()
  );
  check(
    "ไม่เสนอการ์ดข้ามขั้น และไม่เสนอของตัวละครอื่น",
    !onLeader.some((c) => c.level > leader.card.level + 1 || c.name !== leader.card.name)
  );
  check(
    "ทุกใบที่เสนอ เอนจินรับจริง",
    onLeader.every((card) => {
      const ids = s.boards.p1.hand.slice(0, card.level).map((c) => c.id);
      return (
        drive(s, "p1", { kind: "levelUp", characterId: card.id, discardIds: ids }).result.error ===
        null
      );
    })
  );
  check("มีตัวหลังอยู่ -> สลับ Leader ได้", canSwitchLeader(s, "p1"));
  check(
    "ฝ่ายที่ไม่ใช่เจ้าของเทิร์น -> ไม่มีอะไรให้เลือก",
    !canSwitchLeader(s, "p2") &&
      levelUpOptions(s, "p2", s.boards.p2.leader!.card.id).length === 0
  );

  // Mid-clash there is no Action Phase move to be had at all.
  const counter = structuredClone(s);
  counter.phase = "counter";
  check(
    "นอกเฟสแอ็กชัน -> ไม่เสนอทั้งเลเวลอัปและสลับ",
    levelUpOptions(counter, "p1", leader.card.id).length === 0 && !canSwitchLeader(counter, "p1")
  );

  // One action per turn: using it closes both moves for the rest of the turn.
  const used = structuredClone(s);
  used.boards.p1.actionsTakenThisTurn.push("levelUp", "switch");
  check(
    "ใช้แอ็กชันของเทิร์นไปแล้ว -> ไม่เสนออีก",
    levelUpOptions(used, "p1", leader.card.id).length === 0 && !canSwitchLeader(used, "p1")
  );

  // The cost is paid out of hand, so an empty hand cannot afford anything.
  const broke = structuredClone(s);
  broke.boards.p1.hand = [];
  check(
    "ไม่มีการ์ดในมือให้ทิ้ง -> ไม่เสนอเลเวลอัป",
    levelUpOptions(broke, "p1", leader.card.id).length === 0
  );

  // Nobody in the back means nobody to swap with.
  const alone = structuredClone(s);
  alone.boards.p1.back = [];
  check("ไม่มีตัวหลัง -> สลับไม่ได้", !canSwitchLeader(alone, "p1"));

  // A card that shut switching off for the turn is respected here too.
  const stopped = structuredClone(s);
  stopped.turnLog.flags.p1 = ["noLeaderSwitch"];
  check("โดนห้ามสลับในเทิร์นนี้ -> ไม่เสนอ", !canSwitchLeader(stopped, "p1"));

  // Laying a card down belongs to the Counter Phase, and nobody can lay one
  // while the Action Phase is still running — not even the turn player. That
  // is what keeps the player who lays the first card from deciding when
  // everybody's Action Phase ended.
  check("เฟสแอ็กชัน: ยังลงคว่ำไม่ได้ทั้งสองฝ่าย", !canCommit(s, "p1") && !canCommit(s, "p2"));
  const earlyP2 = step(s, "p2", { kind: "commit", cardId: s.boards.p2.hand[0].id }, []);
  check("เฟสแอ็กชัน: ฝ่ายรับฝืนลงคว่ำ -> ถูกปฏิเสธ", earlyP2.error !== null, earlyP2.error ?? "(ไม่ปฏิเสธ)");
  check("และเมนเฟสไม่ถูกข้าม", earlyP2.state.phase === "action", earlyP2.state.phase);
  const earlyPass = step(s, "p2", { kind: "pass" }, []);
  check("ฝ่ายรับกดไม่ลงการ์ดเพื่อปิดเมนเฟสก็ไม่ได้", earlyPass.error !== null, earlyPass.error ?? "(ไม่ปฏิเสธ)");
  check(
    "ฝ่ายที่ไม่ใช่เจ้าของเทิร์นไม่มีสิทธิ์อื่นเลย",
    legalIntents(s, "p2").length === 0,
    legalIntents(s, "p2").join()
  );

  // The turn player opens it on purpose, and only they may.
  check("เฟสแอ็กชัน: เจ้าของเทิร์นมีสิทธิ์ไปเฟสประลอง", legalIntents(s, "p1").includes("toBattle"));
  const p2Opens = step(s, "p2", { kind: "toBattle" }, []);
  check("ฝ่ายรับเปิดเฟสประลองเองไม่ได้", p2Opens.error !== null, p2Opens.error ?? "(ไม่ปฏิเสธ)");
  const opened = drive(s, "p1", { kind: "toBattle" }).result.state;
  check("เจ้าของเทิร์นกด Battle -> เข้าเฟสประลอง", opened.phase === "counter", opened.phase);
  check("เปิดแล้ว -> ลงคว่ำได้ทั้งสองฝ่าย", canCommit(opened, "p1") && canCommit(opened, "p2"));

  const laid = drive(opened, "p1", { kind: "commit", cardId: opened.boards.p1.hand[0].id }).result
    .state;
  check("ลงคว่ำแล้ว -> ยังอยู่เฟสประลอง", laid.phase === "counter", laid.phase);
  check("ลงคว่ำไปแล้ว -> ลงซ้ำไม่ได้", !canCommit(laid, "p1"));
  check("อีกฝ่ายยังลงได้อยู่", canCommit(laid, "p2"));
  check(
    "และเอนจินรับจริง",
    drive(laid, "p2", { kind: "commit", cardId: laid.boards.p2.hand[0].id }).result.error === null
  );
  check(
    "และเอนจินปฏิเสธจริงถ้าฝืนลงซ้ำ",
    drive(laid, "p1", { kind: "commit", cardId: laid.boards.p1.hand[0].id }).result.error !== null
  );
  const won = structuredClone(s);
  won.winnerId = "p1";
  check("จบเกมแล้ว -> ลงคว่ำไม่ได้", !canCommit(won, "p1") && !canCommit(won, "p2"));
  check(
    "และเอนจินก็ปฏิเสธจริงถ้าฝืนสั่ง",
    drive(stopped, "p1", { kind: "switch", toCardId: stopped.boards.p1.back[0].card.id }).result
      .error !== null
  );
}

// --- The log says WHY the clash went the way it did ------------------------
//
// A win is not always visible: a 0-attack Dodge beats a red card on colour
// alone, so the loser takes nothing and the only sign anything happened is a
// [Judgement] skill firing off the win. "p1 wins the clash" on its own reads
// like the engine got it wrong.

{
  const clash = (p1Card: string, p2Card: string) => {
    let s = drive(newMatch(), "p1", { kind: "startTurn" }).result.state;
    s.boards.p1.hand = [action(p1Card)];
    s.boards.p2.hand = [action(p2Card)];
    s.boards.p1.competitionArea = [action("BP01-044"), action("BP01-044")];
    s.boards.p2.competitionArea = [action("BP01-044"), action("BP01-044")];
    s = drive(s, "p1", { kind: "commit", cardId: p1Card }).result.state;
    s = drive(s, "p2", { kind: "commit", cardId: p2Card }).result.state;
    return drive(s, "p1", { kind: "resolveCounter" }).result;
  };
  const clashLine = (log: LogLine[]) =>
    log.find((line) => line.th.includes("การปะทะ"))?.th ?? "(no clash line)";

  // BP01-045 is blue, BP01-044 red: blue beats red, whatever the attack says.
  const byColor = clashLine(clash("BP01-045", "BP01-044").log);
  check(
    "ชนะด้วยสี -> บอกในบันทึกว่าสีไหนชนะสีไหน",
    byColor.includes("p1 ชนะการปะทะ") && byColor.includes("น้ำเงินชนะแดง"),
    byColor
  );

  // Same colour: Speed decides, and the log says the numbers.
  const bySpeed = clashLine(clash("BP01-049", "BP01-044").log);
  check(
    "สีเดียวกัน -> ตัดสินด้วย Speed และบอกตัวเลข",
    bySpeed.includes("Speed") && /Speed \d+ ต่อ \d+/.test(bySpeed),
    bySpeed
  );

  // Blue against blue is a draw no matter what.
  const drawn = clashLine(clash("BP01-045", "BP01-045").log);
  check("น้ำเงินชนกัน -> เสมอ", drawn.includes("เสมอ"), drawn);

  // Nobody laid a card out against it.
  let solo = drive(newMatch(), "p1", { kind: "startTurn" }).result.state;
  solo.boards.p1.hand = [action("BP01-044")];
  solo.boards.p1.competitionArea = [action("BP01-044")];
  solo = drive(solo, "p1", { kind: "commit", cardId: "BP01-044" }).result.state;
  solo = drive(solo, "p2", { kind: "pass" }).result.state;
  const unopposed = clashLine(drive(solo, "p1", { kind: "resolveCounter" }).result.log);
  check(
    "อีกฝ่ายไม่ลงการ์ด -> บอกว่าชนะเพราะไม่มีคู่ต่อสู้",
    unopposed.includes("อีกฝ่ายไม่ได้ลงการ์ด"),
    unopposed
  );
}

// --- Every log line names the card behind it, for the battle log's art ----

{
  let s = drive(newMatch(), "p1", { kind: "startTurn" }).result.state;
  s.boards.p1.hand = [action("BP01-049")];
  s.boards.p2.hand = [action("BP01-044")];
  s.boards.p1.competitionArea = [action("BP01-044"), action("BP01-044")];
  s = drive(s, "p1", { kind: "commit", cardId: "BP01-049" }).result.state;
  s = drive(s, "p2", { kind: "commit", cardId: "BP01-044" }).result.state;
  const out = drive(s, "p1", { kind: "resolveCounter" }).result;

  const credited = out.log.filter((line) => /\[[A-Z]{2}\d{2}-\d{3}/.test(line.th)).map((l) => l.th);
  check(
    "บรรทัดที่มีการ์ดเป็นต้นเหตุ ระบุเลขการ์ดไว้ให้รูปขึ้นได้",
    credited.some((line) => line.includes("จ่าย")) &&
      credited.some((line) => line.includes("เปิด")),
    credited.join(" | ")
  );
  check(
    "ไม่มีบรรทัดไหนถูกระบุการ์ดซ้ำสองครั้ง",
    credited.every((line) => (line.match(/\[[A-Z]{2}\d{2}-\d{3}/g) ?? []).length === 1),
    credited.join(" | ")
  );
  check(
    "เปิดการ์ดแยกบรรทัดต่อฝั่ง จะได้ติดรูปของตัวเองได้",
    out.log.filter((line) => line.th.includes("เปิด ")).length === 2,
    out.log.filter((line) => line.th.includes("เปิด ")).map((l) => l.th).join(" | ")
  );
}

// --- What [Level up] means -------------------------------------------------
//
// It happens TO the card already on the field, not to the one being played:
// "when this character is levelled up" is the card underneath being covered.
// The card arriving gets [Enter] instead, which is why so many of them are
// printed "[Enter] / [Level up]" — both moments, one line.

{
  const shorekeeper = () => {
    let s = drive(newMatch(), "p1", { kind: "startTurn" }).result.state;
    s.boards.p1.leader = {
      position: "leader",
      card: character("BP01-010"), // Shorekeeper Lv.0
      under: [],
    };
    s.boards.p1.characterPool = [character("BP01-009"), character("BP01-007")];
    return s;
  };

  // BP01-009 is "[Enter] / [Level up] you MAY take an {Intro Skill} from the
  // trash": arriving is [Enter].
  const arriving = shorekeeper();
  arriving.boards.p1.trash = [action("BP01-063")];
  const onArrival = drive(arriving, "p1", {
    kind: "levelUp",
    characterId: "BP01-009",
    discardIds: [arriving.boards.p1.hand[0].id],
  });
  check(
    "การ์ดที่ลงมาใหม่ -> [Enter] ทำงาน",
    onArrival.asked.includes("BP01-009"),
    onArrival.asked.join()
  );

  // Then BP01-007 goes on top of it, and BP01-009 is the one being levelled
  // up — so this time it is [Level up] that fires, on the card underneath.
  let stacked = onArrival.result.state;
  stacked.boards.p1.actionsTakenThisTurn = [];
  stacked.boards.p1.trash = [action("BP01-063")];
  const onCovered = drive(stacked, "p1", {
    kind: "levelUp",
    characterId: "BP01-007",
    discardIds: stacked.boards.p1.hand.slice(0, 2).map((c) => c.id),
  });
  check(
    "การ์ดที่ถูกทับ -> [Level up] ทำงาน ไม่ใช่ใบที่เพิ่งลง",
    onCovered.asked.includes("BP01-009"),
    onCovered.asked.join() || "(ไม่มีอะไรถาม)"
  );
  check(
    "กองยังอยู่ครบ ใบล่างไม่ได้หายไปไหน",
    onCovered.result.state.boards.p1.leader?.card.id === "BP01-007" &&
      onCovered.result.state.boards.p1.leader?.under.map((c) => c.id).join() ===
        "BP01-010,BP01-009",
    onCovered.result.state.boards.p1.leader?.under.map((c) => c.id).join()
  );

  // A second Level 2 (BP01-006) goes over the first, leaving BP01-009 two
  // levels down. It is still in play and still "this character", so its
  // [Level up] fires again — the rules stack the pile face-up precisely
  // because the lower levels keep their skills. Firing only on the card
  // directly beneath made BP01-009 go silent from here on.
  let deeper = onCovered.result.state;
  deeper.boards.p1.actionsTakenThisTurn = [];
  deeper.boards.p1.trash = [action("BP01-063")];
  // A second Level 2 for the same character — legal, a card of the level they
  // are already at counts. The fixture's pool only stocks the first ladder.
  deeper.boards.p1.characterPool = [character("BP01-006")];
  const twoDown = drive(deeper, "p1", {
    kind: "levelUp",
    characterId: "BP01-006",
    discardIds: deeper.boards.p1.hand.slice(0, 2).map((c) => c.id),
  });
  check(
    "ใบที่อยู่ลึกลงไป 2 ชั้น -> [Level up] ยังทำงาน",
    twoDown.asked.includes("BP01-009"),
    twoDown.asked.join() || "(ไม่มีอะไรถาม)"
  );
  check(
    "และหยิบการ์ดจากกองทิ้งได้จริง",
    twoDown.result.state.boards.p1.trash.every((c) => c.id !== "BP01-063"),
    twoDown.result.state.boards.p1.trash.map((c) => c.id).join() || "(กองทิ้งว่าง)"
  );
  check(
    "กองลึก 4 ใบ เรียงตามที่ลงไว้",
    [
      ...(twoDown.result.state.boards.p1.leader?.under ?? []).map((c) => c.id),
      twoDown.result.state.boards.p1.leader?.card.id,
    ].join() === "BP01-010,BP01-009,BP01-007,BP01-006",
    [
      ...(twoDown.result.state.boards.p1.leader?.under ?? []).map((c) => c.id),
      twoDown.result.state.boards.p1.leader?.card.id,
    ].join()
  );

  // BP01-001 is "[Level up] return this card to the Character Deck". Fired on
  // the card arriving, it bounced itself off the field the moment it landed.
  let camellya = drive(newMatch(), "p1", { kind: "startTurn" }).result.state;
  camellya.boards.p1.leader = { position: "leader", card: character("BP01-003"), under: [] };
  camellya.boards.p1.characterPool = [character("BP01-001")];
  const played = drive(camellya, "p1", {
    kind: "levelUp",
    characterId: "BP01-001",
    discardIds: camellya.boards.p1.hand.slice(0, 2).map((c) => c.id),
  });
  check(
    "BP01-001 ลงแล้วอยู่ในสนาม ไม่เด้งกลับ Character Deck เอง",
    played.result.state.boards.p1.leader?.card.id === "BP01-001" &&
      played.result.state.boards.p1.characterPool.length === 0,
    `leader=${played.result.state.boards.p1.leader?.card.id} pool=${played.result.state.boards.p1.characterPool.map((c) => c.id).join()}`
  );
}

// --- "At start of own Battle phase" means the start ------------------------

{
  let s = drive(newMatch(), "p1", { kind: "startTurn" }).result.state;
  // BP01-007: "[Leader] [At start of own Battle phase] if your hand is 4 or
  // fewer, draw up to 5."
  s.boards.p1.leader = {
    position: "leader",
    card: character("BP01-007"),
    under: [character("BP01-010")],
  };
  s.boards.p1.hand = [action("BP01-044"), action("BP01-044")];
  s.boards.p1.competitionArea = [action("BP01-044")];

  // Opening the phase is its own move now, so "at the start" is literally at
  // the start: the draw happens before anybody has laid a card down.
  const opened = drive(s, "p1", { kind: "toBattle" }).result.state;
  check("เข้าเฟสประลอง", opened.phase === "counter", opened.phase);
  check(
    "จั่วให้ครบ 5 ตั้งแต่เฟสประลองเริ่ม ไม่ใช่ตอนเปิดการ์ด",
    opened.boards.p1.hand.length === 5,
    `${opened.boards.p1.hand.length}`
  );

  const committed = drive(opened, "p1", { kind: "commit", cardId: "BP01-044" }).result.state;
  check(
    "ลงคว่ำหลังจากนั้น -> มือลดลง 1 ใบ ไม่จั่วเพิ่ม",
    committed.boards.p1.hand.length === 4,
    `${committed.boards.p1.hand.length}`
  );

  // And exactly once — the second player choosing does not open the phase
  // again.
  const both = drive(committed, "p2", { kind: "pass" }).result.state;
  check(
    "อีกฝ่ายลงตาม -> ไม่ได้จั่วซ้ำ",
    both.boards.p1.hand.length === 4,
    `${both.boards.p1.hand.length}`
  );
}

// --- Red's follow-up chain really is unlimited -----------------------------

{
  let s = drive(newMatch(), "p1", { kind: "startTurn" }).result.state;
  s.boards.p1.hand = Array.from({ length: 9 }, () => action("BP01-044"));
  s.boards.p1.competitionArea = Array.from({ length: 12 }, () => action("BP01-044"));
  s = drive(s, "p1", { kind: "commit", cardId: "BP01-044" }).result.state;
  s = drive(s, "p2", { kind: "pass" }).result.state;
  s = drive(s, "p1", { kind: "resolveCounter" }).result.state;
  check("ชนะด้วยแดง -> คอมโบไม่จำกัด", s.combo?.unlimited === true, JSON.stringify(s.combo));

  let played = 0;
  for (let i = 0; i < 8; i += 1) {
    const out = drive(s, "p1", { kind: "combo", cardId: "BP01-044" });
    if (out.result.error) break;
    s = out.result.state;
    played += 1;
  }
  check(
    "ต่อเนื่องได้เกิน 5 ใบ ไม่โดน Action Area จำกัด",
    played === 8,
    `ต่อได้ ${played} ใบ, Action Area ${(s.actionZone.p1 ?? []).length} ใบ`
  );
}

// --- A limited Follow{8} window really allows eight ------------------------
//
// SD02-010 grants +8 [follow-up attack] on [Judgement]. That is a limited
// window (unlimited: false, remaining: 8), and a blanket 5-card Action Area
// cap used to choke it at five. The Action Area is unbounded; only the
// window's own count limits it.
{
  let s = newMatch();
  s.phase = "combo";
  s.turnPlayerId = "p1";
  s.combo = { playerId: "p1", unlimited: false, remaining: 8 };
  s.boards.p1.hand = Array.from({ length: 8 }, () => action("BP01-044"));
  s.boards.p1.competitionArea = Array.from({ length: 12 }, () => action("BP01-044"));

  let played = 0;
  for (let i = 0; i < 8; i += 1) {
    const out = drive(s, "p1", { kind: "combo", cardId: "BP01-044" });
    if (out.result.error) break;
    s = out.result.state;
    played += 1;
  }
  check(
    "Follow{8}: ต่อได้ครบ 8 ใบ ไม่โดน Action Area จำกัดที่ 5",
    played === 8 && (s.actionZone.p1 ?? []).length === 8,
    `ต่อได้ ${played} ใบ, Action Area ${(s.actionZone.p1 ?? []).length} ใบ, remaining=${s.combo?.remaining}`
  );
  const ninth = step(s, "p1", { kind: "combo", cardId: "BP01-044" });
  check(
    "Follow{8}: ใบที่ 9 เกินสิทธิ์ -> ต่อไม่ได้",
    ninth.error === "No follow-ups left",
    ninth.error ?? "(ไม่ปฏิเสธ)"
  );
}

// --- A card only an ability may put into play ------------------------------

{
  let s = drive(newMatch(), "p1", { kind: "startTurn" }).result.state;
  // Encore Lv.1 leading, with both Level 2 cards in the deck: BP01-011 is
  // tagged abilityOnly, BP01-012 is not.
  s.boards.p1.leader = {
    position: "leader",
    card: character("BP01-013"),
    under: [character("BP01-015")],
  };
  s.boards.p1.characterPool = [character("BP01-011"), character("BP01-012")];

  check(
    "เมนูไม่เสนอใบที่ลงได้เฉพาะจากความสามารถ",
    levelUpOptions(s, "p1", "BP01-013").map((c) => c.id).join() === "BP01-012",
    levelUpOptions(s, "p1", "BP01-013").map((c) => c.id).join()
  );
  check(
    "ฝืนสั่งเลเวลอัปใบนั้นตรงๆ -> เอนจินปฏิเสธ",
    drive(s, "p1", {
      kind: "levelUp",
      characterId: "BP01-011",
      discardIds: s.boards.p1.hand.slice(0, 2).map((c) => c.id),
    }).result.error !== null
  );
}

// --- "if this card was not played this round" ------------------------------
//
// BP01-011 goes home at the end of a turn it did not arrive in. It reaches
// the field by being levelled up, which never touched the turn log, so the
// answer used to be "not played" even on the turn it landed — and it left
// again immediately.

{
  let s = drive(newMatch(), "p1", { kind: "startTurn" }).result.state;
  s.boards.p1.leader = {
    position: "leader",
    card: character("BP01-013"),
    under: [character("BP01-015")],
  };
  s.boards.p1.characterPool = [character("BP01-012")];
  const landed = drive(s, "p1", {
    kind: "levelUp",
    characterId: "BP01-012",
    discardIds: s.boards.p1.hand.slice(0, 2).map((c) => c.id),
  }).result.state;
  check(
    "ตัวละครที่เพิ่งลง ถูกบันทึกว่าลงในเทิร์นนี้",
    (landed.turnLog.charactersPlayed.p1 ?? []).includes("BP01-012"),
    JSON.stringify(landed.turnLog.charactersPlayed)
  );

  // And the record is cleared with the rest of the turn log — which means
  // playing the turn out to its end, not just asking for one.
  // Emptied so the turn player is ALLOWED to skip the clash (rule: they must
  // lay a card down while they hold one they can play).
  landed.boards.p1.hand = [];
  let nextTurn = drive(landed, "p1", { kind: "pass" }).result.state;
  nextTurn = drive(nextTurn, "p2", { kind: "pass" }).result.state;
  nextTurn = drive(nextTurn, "p1", { kind: "resolveCounter" }).result.state;
  nextTurn = drive(nextTurn, "p1", { kind: "endTurn" }).result.state;
  nextTurn = drive(nextTurn, "p2", { kind: "startTurn" }).result.state;
  check("เทิร์นเดินต่อไปถึงตา p2 จริง", nextTurn.turnPlayerId === "p2", nextTurn.turnPlayerId);
  check(
    "ขึ้นเทิร์นใหม่ -> บันทึกถูกล้าง",
    (nextTurn.turnLog.charactersPlayed.p1 ?? []).length === 0,
    JSON.stringify(nextTurn.turnLog.charactersPlayed)
  );
}

// --- "each round, damage taken -1" is once a round -------------------------

{
  let s = drive(newMatch(), "p1", { kind: "startTurn" }).result.state;
  s.boards.p2.leader = { position: "leader", card: character("BP01-002"), under: [] };
  s.boards.p1.hand = Array.from({ length: 6 }, () => action("BP01-044")); // red, 1 damage
  s.boards.p1.competitionArea = Array.from({ length: 10 }, () => action("BP01-044"));

  s = drive(s, "p1", { kind: "commit", cardId: "BP01-044" }).result.state;
  s = drive(s, "p2", { kind: "pass" }).result.state;
  s = drive(s, "p1", { kind: "resolveCounter" }).result.state;
  check("ครั้งแรกโดนลด -> ไม่เสียเลือด", s.boards.p2.life === 20, `${s.boards.p2.life}`);

  for (let i = 0; i < 4; i += 1) {
    const out = drive(s, "p1", { kind: "combo", cardId: "BP01-044" });
    if (out.result.error) break;
    s = out.result.state;
  }
  check(
    "ครั้งต่อๆ ไปไม่ลดแล้ว",
    s.boards.p2.life === 16,
    `เหลือ ${s.boards.p2.life}, โดน ${s.turnLog.hitsTaken.p2} ครั้ง`
  );
}


// --- [Battle] belongs to the initial revealed clash ------------------------
//
// A red follow-up happens later in the overall battle, but it does not become
// one of the two cards committed face-down for the determining clash. It gets
// [Enter] and [Combo], while [Battle] and [Judgement] stay with that initial
// reveal/judgement pair.

{
  // p1 lays nothing down, so p2's red card wins unopposed and takes the
  // (unlimited) combo window.
  let s = drive(newMatch(), "p1", { kind: "startTurn" }).result.state;
  s.boards.p2.hand = [action("BP01-044"), action("BP01-062")];
  s.boards.p2.competitionArea = Array.from({ length: 4 }, () => action("BP01-044"));
  // Empty, because the turn player may only skip the clash with nothing
  // playable in hand.
  s.boards.p1.hand = [];

  s = drive(s, "p1", { kind: "pass" }).result.state;
  s = drive(s, "p2", { kind: "commit", cardId: "BP01-044" }).result.state;
  s = drive(s, "p1", { kind: "resolveCounter" }).result.state;
  check("p2 ชนะแบบไม่มีคู่ต่อสู้ -> ได้หน้าต่างคอมโบ", s.combo?.playerId === "p2", JSON.stringify(s.combo));
  check("Encore ยังอยู่ Level 0 ก่อนคอมโบ", s.boards.p2.leader?.card.id === "BP01-015", s.boards.p2.leader?.card.id ?? "-");

  const out = drive(s, "p2", { kind: "combo", cardId: "BP01-062" });
  s = out.result.state;
  check("BP01-062 ลงเป็นคอมโบได้", !out.result.error, out.result.error ?? "");
  check(
    "[Battle] ของ BP01-062 ไม่ทำงานตอนใช้กลางคอมโบ",
    s.boards.p2.leader?.card.id === "BP01-015" &&
      s.boards.p2.characterPool.some((card) => card.id === "BP01-011"),
    `leader=${s.boards.p2.leader?.card.id} pool=${s.boards.p2.characterPool.map((card) => card.id).join()}`
  );
}

// --- [Advantage] starts the turn AFTER it was won ---------------------------

{
  let s = drive(newMatch(), "p1", { kind: "startTurn" }).result.state;
  s.boards.p1.hand = [action("BP01-044"), action("BP01-062")];
  s.boards.p1.competitionArea = Array.from({ length: 6 }, () => action("BP01-044"));

  s = drive(s, "p1", { kind: "commit", cardId: "BP01-044" }).result.state;
  s = drive(s, "p2", { kind: "pass" }).result.state;
  s = drive(s, "p1", { kind: "resolveCounter" }).result.state;
  const liberation = action("BP01-062");
  check("p1 ชนะการตัดสิน", s.lastBattleWinnerId === "p1", s.lastBattleWinnerId ?? "-");
  check(
    "เทิร์นที่ชนะ: ยังไม่มี Advantage",
    s.advantageIds.length === 0,
    s.advantageIds.join(",")
  );
  check(
    "แต่จอง Advantage เทิร์นหน้าไว้ให้ p1 แล้ว",
    s.pendingAdvantageIds.join(",") === "p1",
    s.pendingAdvantageIds.join(",")
  );
  check(
    "เทิร์นที่ชนะ: cost ของ BP01-062 ยังเป็น 2",
    effectiveCost(s, liberation, "p1") === 2,
    `${effectiveCost(s, liberation, "p1")}`
  );

  s = drive(s, "p1", { kind: "endTurn" }).result.state;
  s = drive(s, "p2", { kind: "startTurn" }).result.state;
  check(
    "เทิร์นถัดไป: Advantage เป็นของ p1",
    s.advantageIds.join(",") === "p1",
    s.advantageIds.join(",")
  );
  check(
    "เทิร์นถัดไป: cost ของ BP01-062 ลดเหลือ 1",
    effectiveCost(s, liberation, "p1") === 1,
    `${effectiveCost(s, liberation, "p1")}`
  );
}

// --- Rule: the turn player must lay a card down ------------------------------
//
// The non-turn player may always decline the clash. The turn player declared
// the phase and may only skip when nothing in hand is playable — and skipping
// then shows their hand, which is how the rules make them prove it.

{
  let s = drive(newMatch(), "p1", { kind: "startTurn" }).result.state;
  s = drive(s, "p1", { kind: "toBattle" }).result.state;
  s.boards.p1.hand = [action("BP01-049")]; // cost 2
  s.boards.p1.competitionArea = [action("BP01-044"), action("BP01-044")];

  check("มีใบที่ลงได้ -> canPassCounter ปิดสิทธิ์ pass ของเจ้าของเทิร์น", !canPassCounter(s, "p1"));
  check(
    "และ legalIntents ก็ไม่เสนอ pass",
    !legalIntents(s, "p1").includes("pass"),
    legalIntents(s, "p1").join(",")
  );
  const refused = drive(s, "p1", { kind: "pass" }).result;
  check("ฝืน pass -> เอนจินปฏิเสธ", Boolean(refused.error), refused.error ?? "ไม่ปฏิเสธ");

  // The other side is not bound by this, even with a card it could play.
  check("ฝ่ายที่ไม่ใช่เจ้าของเทิร์น pass ได้เสมอ", canPassCounter(s, "p2"));

  // Nothing affordable: now the skip is legal, and the hand goes face-up.
  const broke = structuredClone(s);
  broke.boards.p1.competitionArea = [];
  check("จ่ายค่าการ์ดไม่ไหว -> pass ได้", canPassCounter(broke, "p1"));
  const passed = drive(broke, "p1", { kind: "pass" }).result;
  check("และ pass ผ่านจริง", !passed.error, passed.error ?? "");
  check(
    "เจ้าของเทิร์นที่ข้าม -> เปิดมือให้อีกฝ่ายดู",
    passed.state.revealedHands.includes("p1"),
    JSON.stringify(passed.state.revealedHands)
  );
}

// --- Rule: rebuilding a spent deck ------------------------------------------
//
// Drawing tops the deck up part-way through; everything else takes what is
// there and the rebuild waits for the end of the step.

{
  let s = drive(newMatch(), "p1", { kind: "startTurn" }).result.state;
  s.boards.p1.trash = s.boards.p1.actionDeck.splice(0, 8);
  s.boards.p1.actionDeck = s.boards.p1.actionDeck.slice(0, 1);
  s.lastBattleWinnerId = "p1"; // BP01-028 only fires on a win
  s.boards.p1.leader = { position: "leader", card: character("BP01-028"), under: [] };
  // Reveal 5 off a 1-card deck: 1 card, not a fresh shuffle and 5.
  const top = resolveTrigger(s, "judgement", [
    { card: requireCard("BP01-028"), controllerId: "p1", zone: "leader" },
  ]);
  check(
    "เปิด 5 ใบจากเด็คที่เหลือ 1 ใบ -> ได้แค่ 1 ใบ ไม่สร้างเด็คใหม่กลางทาง",
    top.state.boards.p1.actionDeck.length === 0,
    `deck=${top.state.boards.p1.actionDeck.length} trash=${top.state.boards.p1.trash.length}`
  );
}

// --- Rule: the Action Phase has two exits -----------------------------------
//
// Leaving the Action Phase, the turn player declares either the Counter Phase or
// the End Phase. Skipping the Counter Phase is not the same as laying nothing
// down inside it: no clash happens at all, and it is the only thing that
// satisfies the second half of [Advantage].

{
  let s = drive(newMatch(), "p1", { kind: "startTurn" }).result.state;
  check(
    "เฟสหลักเสนอทั้ง toBattle และ skipCounter",
    legalIntents(s, "p1").includes("toBattle") && legalIntents(s, "p1").includes("skipCounter"),
    legalIntents(s, "p1").join(",")
  );
  const skipped = drive(s, "p1", { kind: "skipCounter" }).result;
  check("skipCounter -> กระโดดไปเฟสจบเทิร์น", skipped.state.phase === "end", skipped.state.phase);
  check("ไม่เกิดการปะทะ -> ไม่มีผู้ชนะ", skipped.state.lastBattleWinnerId === null);
  check(
    "อีกฝ่ายจะได้ Advantage เทิร์นหน้า",
    skipped.state.pendingAdvantageIds.join(",") === "p2",
    skipped.state.pendingAdvantageIds.join(",")
  );

  s = drive(skipped.state, "p1", { kind: "endTurn" }).result.state;
  s = drive(s, "p2", { kind: "startTurn" }).result.state;
  check(
    "เปิดเทิร์นใหม่ -> p2 ถือ Advantage ทั้งที่ไม่ได้ชนะการปะทะ",
    s.advantageIds.join(",") === "p2",
    s.advantageIds.join(",")
  );
  // Only the turn player's call.
  const notYours = drive(s, "p1", { kind: "skipCounter" }).result;
  check("ฝ่ายที่ไม่ใช่เจ้าของเทิร์นข้ามไม่ได้", Boolean(notYours.error), notYours.error ?? "");
}

// --- Rule: a character's pile stops at 5 ------------------------------------

{
  let s = drive(newMatch(), "p1", { kind: "startTurn" }).result.state;
  // Camellya 0 > 1 > 2 > 2 > 2 is five cards, the ceiling.
  const leader = s.boards.p1.leader!;
  s.boards.p1.leader = {
    ...leader,
    card: character("BP01-001"),
    under: [character("BP01-005"), character("BP01-003"), character("BP01-001"), character("BP01-001")],
  };
  s.boards.p1.characterPool = [character("BP01-001")];
  check(
    "กองสูง 5 ใบ -> เมนูไม่เสนออะไรเลย",
    levelUpOptions(s, "p1", s.boards.p1.leader!.card.id).length === 0,
    `${levelUpOptions(s, "p1", s.boards.p1.leader!.card.id).length}`
  );
  const refused = drive(s, "p1", {
    kind: "levelUp",
    characterId: "BP01-001",
    discardIds: s.boards.p1.hand.slice(0, 2).map((c) => c.id),
  }).result;
  check("ฝืนสั่ง -> เอนจินปฏิเสธ", Boolean(refused.error), refused.error ?? "ไม่ปฏิเสธ");
}

// --- Rule: [Switch] belongs to the two characters that moved -----------------
//
// "Triggers when the character carrying it IS switched", and a character is
// switched only when its own position changed. Raising it board-wide fired it on
// the character that stayed in the back — and on the opponent's board.

{
  let s = drive(newMatch(), "p1", { kind: "startTurn" }).result.state;
  // BP01-008 is Shorekeeper Lv.2 with [Switch] "you may draw 1, then discard 1".
  // Parked in a BACK slot that is NOT the one being switched in, so if it fires
  // at all, it fired for a character that never moved.
  s.boards.p1.back = [
    { position: "back", card: character("BP01-024"), under: [] },
    { position: "back", card: character("BP01-008"), under: [] },
  ];
  const handBefore = s.boards.p1.hand.length;
  const out = drive(s, "p1", { kind: "switch", toCardId: "BP01-024" });
  check("สลับตัวสำเร็จ", !out.result.error, out.result.error ?? "");
  check(
    "[Switch] ของตัวที่ไม่ได้สลับ -> ไม่ทำงาน",
    out.asked.length === 0 && out.result.state.boards.p1.hand.length === handBefore,
    `asked=${out.asked.join(",")} hand=${out.result.state.boards.p1.hand.length} (ก่อน ${handBefore})`
  );

  // And it DOES fire for a character that was switched.
  let t = drive(newMatch(), "p1", { kind: "startTurn" }).result.state;
  t.boards.p1.back = [
    { position: "back", card: character("BP01-008"), under: [] },
    { position: "back", card: character("BP01-024"), under: [] },
  ];
  const moved = drive(t, "p1", { kind: "switch", toCardId: "BP01-008" });
  check(
    "[Switch] ของตัวที่สลับขึ้นมา -> ทำงาน",
    moved.asked.includes("BP01-008"),
    moved.asked.join(",") || "ไม่ถูกถาม"
  );

  // Rule 906.2: "a character whose position changed as a result of a switch is
  // said to be switched" — the Leader being displaced just as much as the back
  // character coming forward. [Switch] (913.9.1) fires on being switched, with
  // no requirement to end up leading.
  let u = drive(newMatch(), "p1", { kind: "startTurn" }).result.state;
  u.boards.p1.leader = { position: "leader", card: character("BP01-008"), under: [] };
  u.boards.p1.back = [{ position: "back", card: character("BP01-024"), under: [] }];
  const out2 = drive(u, "p1", { kind: "switch", toCardId: "BP01-024" });
  check(
    "[Switch] ของตัวที่ถูกสลับออกจาก Leader -> ทำงาน",
    out2.asked.includes("BP01-008"),
    out2.asked.join(",") || "ไม่ถูกถาม"
  );
}

// --- Rule: an ability-driven switch is a switch ------------------------------
//
// 913.9.1 says [Switch] fires "when the card is switched" and says nothing
// about how, and FAQ #52 (SD01-009) is itself about an ability-driven one. The
// ctx helpers used to move the two characters silently, so every card that
// reads "switch your Leader" swallowed the trigger.

{
  let s = drive(newMatch(), "p1", { kind: "startTurn" }).result.state;
  s.boards.p1.leader = { position: "leader", card: character("BP01-008"), under: [] };
  s.boards.p1.back = [{ position: "back", card: character("BP01-024"), under: [] }];
  // BP01-063 "[Combo] Switch Leaders..." — any card whose text calls
  // ctx.switchLeaderTo does; resolveTrigger is the shortest way to run one.
  const fired = resolveTrigger(
    s,
    "combo",
    [{ card: requireCard("SD01-009"), controllerId: "p1", zone: "actionZone" }],
    ["Yangyang"]
  );
  check(
    "สลับด้วยเอฟเฟกต์การ์ด -> [Switch] ของตัวที่ถูกสลับออกก็ทำงาน",
    fired.pending?.cardId === "BP01-008",
    fired.pending?.cardId ?? "ไม่ถูกถาม"
  );
}

// --- [At start of own turn] belongs to the turn player ----------------------

{
  // SD01-001 (Rover (F) Lv.2): "[At start of own turn] draw 1". Fired
  // board-wide, the copy on the OTHER player's board drew on this turn too.
  const s = newMatch();
  s.boards.p1.leader!.card = character("SD01-001");
  s.boards.p2.leader!.card = character("SD01-001");
  const handP1 = s.boards.p1.hand.length;
  const handP2 = s.boards.p2.hand.length;
  const after = drive(s, "p1", { kind: "startTurn" }).result.state;
  check(
    "SD01-001: เจ้าของเทิร์นจั่วเพิ่ม 1 ใบ (เทิร์นแรกจั่ว 1 + สกิล 1)",
    after.boards.p1.hand.length === handP1 + 2,
    `${handP1} -> ${after.boards.p1.hand.length}`
  );
  check(
    "SD01-001: ฝ่ายที่ไม่ใช่เจ้าของเทิร์นไม่จั่ว",
    after.boards.p2.hand.length === handP2,
    `${handP2} -> ${after.boards.p2.hand.length}`
  );
}

// --- A cost discount still counts once the card is face-down ----------------

{
  // BP01-062 Cosmos Rave: cost 2, "[Advantage] this card's cost -1". The
  // discount is a passive, rebuilt from the zones a card can sit in — and
  // face-down was not one of them, so by the reveal it had gone and the card
  // was paid for at the full 2. Advantage itself is untouched by the battle:
  // it was settled when the turn began.
  const base = drive(newMatch(), "p1", { kind: "startTurn" }).result.state;
  for (const outcome of ["แพ้สีฟ้า", "ชนะสีเขียว"] as const) {
    const s = structuredClone(base);
    s.phase = "counter";
    s.advantageIds = ["p1"];
    s.boards.p1.hand = [action("BP01-062")];
    s.boards.p1.competitionArea = [action("BP01-044"), action("BP01-047")];
    s.boards.p2.hand = [action(outcome === "แพ้สีฟ้า" ? "BP01-045" : "BP01-047")];
    const c1 = step(s, "p1", { kind: "commit", cardId: "BP01-062" });
    const c2 = step(c1.state, "p2", { kind: "commit", cardId: s.boards.p2.hand[0].id });
    const { result } = drive(c2.state, "p1", { kind: "resolveCounter" });
    check(
      `BP01-062 มี Advantage (${outcome}) -> จ่าย cost 1 ไม่ใช่ 2`,
      result.state.boards.p1.competitionArea.length === 1,
      `Concerto เหลือ ${result.state.boards.p1.competitionArea.length}`
    );
    check(
      `BP01-062 (${outcome}) -> Advantage ยังอยู่ทั้งเทิร์น`,
      result.state.advantageIds.includes("p1"),
      result.state.advantageIds.join(",")
    );
  }
}

// --- "Whenever you heal" reacts to every heal --------------------------------

{
  // BP01-006 Shorekeeper Lv.2: "up to twice per round, whenever you heal,
  // you may draw 1". Written as a passive it ran inside the continuous sweep,
  // which cannot ask or keep a draw, and never went off at all.
  const base = drive(newMatch(), "p1", { kind: "startTurn" }).result.state;
  const healWith = (who: "p1" | "p2") => {
    const s = structuredClone(base);
    s.phase = "counter";
    s.boards[who].back[0].card = character("BP01-006");
    s.boards.p1.life = 15;
    s.boards.p1.hand = [action("BP01-053")]; // blue, [Judgement] if you win, heal 1
    s.boards.p2.hand = [action("BP01-044")]; // red: blue beats it
    const c1 = step(s, "p1", { kind: "commit", cardId: "BP01-053" });
    const c2 = step(c1.state, "p2", { kind: "commit", cardId: "BP01-044" });
    return { before: c2.state, ...drive(c2.state, "p1", { kind: "resolveCounter" }) };
  };

  const mine = healWith("p1");
  check("BP01-006: ฮีลแล้ว -> ถามว่าจะจั่วไหม", mine.asked.includes("BP01-006"), mine.asked.join(","));
  check(
    "BP01-006: ตอบจั่ว -> ได้การ์ด 1 ใบ",
    mine.result.state.boards.p1.hand.length === mine.before.boards.p1.hand.length + 1,
    `${mine.before.boards.p1.hand.length} -> ${mine.result.state.boards.p1.hand.length}`
  );
  check("ฮีลจริง 15 -> 16", mine.result.state.boards.p1.life === 16, `${mine.result.state.boards.p1.life}`);

  const theirs = healWith("p2");
  check(
    "BP01-006 ของอีกฝ่าย -> ไม่ทำงานตอนเราฮีล",
    !theirs.asked.includes("BP01-006"),
    theirs.asked.join(",")
  );
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
