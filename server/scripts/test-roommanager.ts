// Room lifecycle: what happens to a match when someone leaves it.
//
// Two things this checks against the actual bug shape rather than the
// happy path: a player who explicitly leaves must forfeit *immediately*
// (no reason to make the other side wait on someone who chose to go), and a
// player whose connection just drops must forfeit only after a real grace
// period — long enough for a refresh, not so long the remaining player is
// stuck. Real timers (90s, 5min) are far too slow to actually wait out in a
// test, so this shrinks them first; see _setGraceMsForTests.
//
// Run with: npm run test:roommanager

import { starterDeck } from "@wuwatcg/shared";
import { playableCharacters } from "@wuwatcg/shared";
import type { RoomRecord } from "../src/roomManager.js";
import {
  _resetRoomsForTests,
  _setGraceMsForTests,
  createRoom,
  getRoom,
  joinRoom,
  leaveRoom,
  markPlayerDisconnected,
  nameOf,
  onMatchForfeited,
  onRoomVacated,
  publicRooms,
  startMatch,
  submitDeck,
  sweepRooms,
} from "../src/roomManager.js";

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  [${detail}]` : ""}`);
  ok ? (pass += 1) : (fail += 1);
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const [CHAR_A, CHAR_B] = playableCharacters();
const DECK_A = starterDeck(CHAR_A);
const DECK_B = starterDeck(CHAR_B);

// Short enough to actually wait out in a test run, long enough that a
// same-tick reconnect clearly beats it.
const FORFEIT_GRACE_MS = 60;
const EMPTY_ROOM_GRACE_MS = 60;
_setGraceMsForTests(FORFEIT_GRACE_MS, EMPTY_ROOM_GRACE_MS);

/** A room with both seats filled and a match dealt, ready to play. */
function seatedMatch(hostId: string, guestId: string) {
  const host = createRoom(hostId, "Host", "private");
  const joined = joinRoom(host.room.code, guestId, "Guest");
  if ("error" in joined) throw new Error(joined.error);
  submitDeck(host, "p1", DECK_A);
  submitDeck(host, "p2", DECK_B);
  const error = startMatch(host);
  if (error) throw new Error(error);
  return host;
}

async function run() {
  // --- Explicit leave forfeits immediately, no waiting -----------------------

  {
    _resetRoomsForTests();
    const record = seatedMatch("host-1", "guest-1");
    check("จับคู่แล้วเริ่มเกมได้", record.room.inMatch && record.session !== null);

    const before = record.session!.winnerId;
    check("ก่อนออกจากห้อง ยังไม่มีผู้ชนะ", before === null);

    // No onMatchForfeited listener here on purpose: an explicit leave is
    // handled synchronously by the socket event itself (see index.ts), which
    // already has everything it needs to emit right after calling
    // leaveRoom() — the listener exists for the OTHER path, a forfeit
    // firing later off a timer with no socket handler around to notice it.
    const after = leaveRoom("guest-1");

    check(
      "guest ออกจากห้อง -> host ชนะทันที ไม่ต้องรอ",
      after?.session?.winnerId === "p1",
      String(after?.session?.winnerId)
    );
    check(
      "บันทึกไว้ว่าออกจากเกม",
      after!.session!.log.some((line) => line.en.includes("p2") && line.en.includes("left"))
    );
    check("host ยังอยู่ในห้องคนเดียว", after?.room.players.length === 1);
    check(
      "ห้องยังอยู่ในสถานะ inMatch เพื่อให้เห็นบอร์ดจบเกม",
      after?.room.inMatch === true
    );
    check(
      "ชื่อของคนที่ออกไปแล้วยังเรียกได้ ไม่กลายเป็น p2 เฉยๆ",
      nameOf(after!, "p2") === "Guest",
      nameOf(after!, "p2")
    );
  }

  // --- A disconnect gets a grace period, not an instant forfeit --------------

  {
    _resetRoomsForTests();
    const record = seatedMatch("host-2", "guest-2");

    // This IS the path the listener exists for: the timer fires with no
    // socket event around it, so this is the only way the remaining player
    // ever finds out.
    let notified: RoomRecord | null = null;
    onMatchForfeited((r) => {
      notified = r;
    });

    markPlayerDisconnected("guest-2");
    check(
      "หลุดการเชื่อมต่อ -> ยังไม่แพ้ทันที",
      record.session!.winnerId === null
    );
    check("ยังไม่มีการแจ้งเตือน ระหว่างรอ", notified === null);

    await sleep(FORFEIT_GRACE_MS + 40);
    check(
      "รอเกินเวลาผ่อนผัน -> ถูกตัดสินแพ้ให้อัตโนมัติ",
      record.session!.winnerId === "p1",
      String(record.session!.winnerId)
    );
    check("และมีการแจ้งเตือนออกไปให้ฝ่ายที่เหลือ", (notified as RoomRecord | null) === record);
  }

  // --- Reconnecting within the grace period cancels the forfeit --------------

  {
    _resetRoomsForTests();
    const record = seatedMatch("host-3", "guest-3");
    markPlayerDisconnected("guest-3");
    await sleep(FORFEIT_GRACE_MS / 2);
    const rejoined = joinRoom(record.room.code, "guest-3", "Guest");
    check("กลับมาทันเวลา -> เข้าห้องได้อีกครั้ง", !("error" in rejoined));

    await sleep(FORFEIT_GRACE_MS + 40);
    check(
      "กลับมาทันเวลา -> ไม่ถูกตัดสินแพ้",
      record.session!.winnerId === null,
      String(record.session!.winnerId)
    );
  }

  // --- Both sides gone: no forfeit (nobody to tell), room reaped instead -----

  {
    _resetRoomsForTests();
    const record = seatedMatch("host-4", "guest-4");
    markPlayerDisconnected("host-4");
    markPlayerDisconnected("guest-4");

    await sleep(FORFEIT_GRACE_MS + 40);
    check(
      "ทั้งคู่หลุดพร้อมกัน -> ไม่มีใครถูกตัดสินแพ้ (ไม่มีใครอยู่ดูผล)",
      record.session!.winnerId === null
    );

    await sleep(EMPTY_ROOM_GRACE_MS + 40);
    check("ห้องที่ไม่มีใครอยู่เลยถูกลบทิ้งในที่สุด", getRoom(record.room.code) === undefined);
  }

  // --- Leaving a match that is already decided is a no-op, not a crash -------

  {
    _resetRoomsForTests();
    const record = seatedMatch("host-5", "guest-5");
    // Reached by a real win in a full game elsewhere — forced here directly,
    // since getting there through actual play is not what this file tests.
    record.session!.forfeit("p2");
    const decided = record.session!.winnerId;
    const after = leaveRoom("guest-5");
    check(
      "ออกจากห้องหลังเกมตัดสินไปแล้ว -> ผลไม่เปลี่ยน",
      after?.session?.winnerId === decided,
      `${decided} -> ${after?.session?.winnerId}`
    );
  }

  // --- Leaving before a match ever starts: no session to forfeit -------------

  {
    _resetRoomsForTests();
    const host = createRoom("host-6", "Host", "private");
    const joined = joinRoom(host.room.code, "guest-6", "Guest");
    if ("error" in joined) throw new Error(joined.error);
    const after = leaveRoom("guest-6");
    check("ออกจากห้องก่อนเริ่มเกม ไม่พัง", after !== undefined && after.session === null);
    check("host เหลือคนเดียวในห้อง", after?.room.players.length === 1);
  }

  // --- One player cannot leave a trail of rooms behind them -----------------

  {
    _resetRoomsForTests();
    let vacated: RoomRecord[] = [];
    onRoomVacated((r) => vacated.push(r));

    // An impatient triple-tap on "create room": three emits, one player.
    createRoom("tapper", "jobcreep", "public");
    createRoom("tapper", "jobcreep", "public");
    const last = createRoom("tapper", "jobcreep", "public");

    check(
      "กดสร้างห้องรัวๆ -> เหลือห้องเดียว ไม่ค้างเป็นห้องร้าง",
      publicRooms().length === 1 && publicRooms()[0].code === last.room.code,
      publicRooms()
        .map((r) => r.code)
        .join(",")
    );
    check(
      "ห้องเก่าถูกลบออกจริง",
      vacated.length === 2 && getRoom(vacated[0].room.code) === undefined
    );

    // And the same on the way in to someone else's room.
    vacated = [];
    const other = createRoom("other-host", "Other", "public");
    const joined = joinRoom(other.room.code, "tapper", "jobcreep");
    check(
      "เข้าห้องคนอื่น -> ห้องเดิมของตัวเองถูกปล่อย",
      !("error" in joined) && vacated.length === 1
    );
    // other-host's room is full now, so an empty list is the whole story:
    // the tapper's own room is gone rather than merely hidden.
    check(
      "ห้องเดิมหายไปจากลิสต์",
      publicRooms().length === 0,
      publicRooms()
        .map((r) => `${r.code} ${r.players}/${r.maxPlayers}`)
        .join(",")
    );
  }

  // --- A seat nobody is attached to is found even with no event to say so ----

  {
    _resetRoomsForTests();
    const ghost = createRoom("ghost-host", "Ghost", "public");
    check("ห้องที่เพิ่งสร้างอยู่ในลิสต์สาธารณะ", publicRooms().length === 1);

    // Nothing called markPlayerDisconnected — this is the state the old bug
    // left behind, and anything else that loses a disconnect would too.
    const swept = sweepRooms(() => false);
    check("กวาดเจอที่นั่งที่ไม่มี socket จริง", swept.length === 1 && swept[0] === ghost);
    check("แล้วห้องหายจากลิสต์ทันที", publicRooms().length === 0);

    await sleep(EMPTY_ROOM_GRACE_MS + 40);
    check("และถูกลบทิ้งตามเวลาผ่อนผันปกติ", getRoom(ghost.room.code) === undefined);

    // A room whose players really are online is left exactly as it was.
    const live = createRoom("live-host", "Live", "public");
    check(
      "ห้องที่ยังมีคนต่ออยู่ ไม่ถูกแตะ",
      sweepRooms(() => true).length === 0 && publicRooms().length === 1
    );
    check("ยังอยู่ในลิสต์เหมือนเดิม", publicRooms()[0].code === live.room.code);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

run();
