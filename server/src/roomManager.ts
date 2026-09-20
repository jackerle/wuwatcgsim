import {
  MatchSession,
  SEATS,
  deckIssues,
  type ChatMessage,
  type DeckList,
  type Player,
  type Room,
  type RoomSummary,
  type RoomVisibility,
  type Seat,
} from "@wuwatcg/shared";

// Characters chosen to avoid visual ambiguity (no 0/O, 1/I).
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 4;
const MAX_PLAYERS = SEATS.length;
const CHAT_LIMIT = 100;

/**
 * How long an empty room is kept before it is thrown away.
 *
 * Both players refreshing at once, or a dropped connection on a phone, must
 * not destroy a match in progress — a room only dies once nobody has come
 * back for a while.
 */
const EMPTY_ROOM_GRACE_MS_DEFAULT = 5 * 60_000;

/**
 * How long a match waits for a disconnected player before the one still
 * there is declared the winner by default.
 *
 * Long enough to survive a refresh or a phone dropping signal for a moment;
 * short enough that the remaining player is not left staring at a frozen
 * board indefinitely because the other side simply walked away.
 */
const DEFAULT_MATCH_FORFEIT_GRACE_MS = 90_000;

/**
 * A match that nobody has touched for this long is abandoned rather than
 * merely slow. It ends as a draw so the final board remains visible, but is
 * no longer counted by /health as an in-progress match blocking deploy.
 */
const DEFAULT_MATCH_INACTIVITY_MS = 5 * 60_000;

let matchForfeitGraceMs = DEFAULT_MATCH_FORFEIT_GRACE_MS;
let emptyRoomGraceMs = EMPTY_ROOM_GRACE_MS_DEFAULT;
let matchInactivityMs = DEFAULT_MATCH_INACTIVITY_MS;

/** Test-only: production timers are too slow to actually wait out. */
export function _setGraceMsForTests(
  forfeit: number,
  emptyRoom: number,
  inactivity = DEFAULT_MATCH_INACTIVITY_MS
): void {
  matchForfeitGraceMs = forfeit;
  emptyRoomGraceMs = emptyRoom;
  matchInactivityMs = inactivity;
}

/** Test-only: drops every room and listener, for a clean slate between cases. */
export function _resetRoomsForTests(): void {
  for (const record of rooms.values()) {
    clearForfeitTimer(record);
    clearActivityTimer(record);
    keepAlive(record);
  }
  rooms.clear();
  playerRoom.clear();
  onForfeit = null;
  onExpiry = null;
  onVacate = null;
}

/** A room plus everything the server keeps for it that players never see raw. */
export interface RoomRecord {
  room: Room;
  session: MatchSession | null;
  /**
   * The deck each seat handed in. Kept here rather than on `room`, which is
   * broadcast to both players — a deck list is 40 cards of information an
   * opponent has no business reading before the match starts.
   */
  decks: Partial<Record<Seat, DeckList>>;
  chat: ChatMessage[];
  /**
   * Every seat's most recently known name, kept even after that seat's
   * player has left. A departed opponent is still named in an old chat line
   * or a "so-and-so left the match" log entry — losing the name the moment
   * they leave would turn every mention of them into a bare "p2".
   */
  lastNames: Partial<Record<Seat, string>>;
  /** Bumped on every restart so a fresh deal is actually a fresh deal. */
  seed: number;
  reapTimer: NodeJS.Timeout | null;
  /** Counting down a disconnected opponent to an automatic forfeit. */
  forfeitTimer: NodeJS.Timeout | null;
  /** Five-minute countdown reset by accepted gameplay, not chat/reconnect. */
  activityTimer: NodeJS.Timeout | null;
}

/**
 * Told about a match ending on its own, mid-timer — a forfeit nobody was
 * watching for actually landing. Set once by the server on startup so this
 * module can raise it without importing the socket server itself (which
 * imports this module, in the other direction).
 */
type ForfeitListener = (record: RoomRecord) => void;
let onForfeit: ForfeitListener | null = null;

export function onMatchForfeited(listener: ForfeitListener): void {
  onForfeit = listener;
}

/**
 * Told about a live match whose players stopped making game decisions. It is
 * distinct from a forfeit: inactivity is a draw, not a loss for either seat.
 */
type ExpiryListener = (record: RoomRecord) => void;
let onExpiry: ExpiryListener | null = null;

export function onMatchExpired(listener: ExpiryListener): void {
  onExpiry = listener;
}

/**
 * Told about a room a player was pulled out of by opening or joining another
 * one — a seat given up without anyone pressing "leave". Whoever is still
 * sitting in that room has to hear about it exactly as they would hear about
 * a deliberate exit, and only the socket server can tell them.
 */
type VacateListener = (record: RoomRecord) => void;
let onVacate: VacateListener | null = null;

export function onRoomVacated(listener: VacateListener): void {
  onVacate = listener;
}

const rooms = new Map<string, RoomRecord>();
/** Stable player id -> room code, so a reconnect finds its way home. */
const playerRoom = new Map<string, string>();

function generateRoomCode(): string {
  let code: string;
  do {
    code = Array.from(
      { length: CODE_LENGTH },
      () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]
    ).join("");
  } while (rooms.has(code));
  return code;
}

function newRecord(room: Room): RoomRecord {
  return {
    room,
    session: null,
    decks: {},
    chat: [],
    lastNames: {},
    seed: Math.floor(Math.random() * 1e9),
    reapTimer: null,
    forfeitTimer: null,
    activityTimer: null,
  };
}

/**
 * Gives up whatever seat this player already holds, before they take another.
 *
 * `playerRoom` has room for exactly one room per player, so creating or
 * joining a second room used to simply overwrite that entry — and the first
 * room was left holding a player it still believed was connected. Nothing
 * ever corrected that: `markPlayerDisconnected` looks the player up through
 * `playerRoom`, which by then pointed at the newer room, so the abandoned one
 * never saw its last player go, never started its empty-room countdown, and
 * sat in the public list advertising "1/2" until the server restarted. Three
 * impatient taps on "create room" left three of them.
 */
function vacatePreviousRoom(playerId: string, except?: RoomRecord): void {
  const previous = getRoomForPlayer(playerId);
  if (!previous || previous === except) return;
  const left = leaveRoom(playerId);
  if (left) onVacate?.(left);
}

export function createRoom(
  playerId: string,
  playerName: string,
  visibility: RoomVisibility = "public"
): RoomRecord {
  vacatePreviousRoom(playerId);
  const code = generateRoomCode();
  const host: Player = {
    id: playerId,
    name: playerName,
    seat: SEATS[0],
    isHost: true,
    connected: true,
  };
  const record = newRecord({
    code,
    players: [host],
    status: "waiting",
    maxPlayers: MAX_PLAYERS,
    visibility,
    picks: {},
    inMatch: false,
  });
  record.lastNames[host.seat] = host.name;
  rooms.set(code, record);
  playerRoom.set(playerId, code);
  return record;
}

export function joinRoom(
  roomCode: string,
  playerId: string,
  playerName: string
): RoomRecord | { error: string } {
  const record = rooms.get(roomCode.toUpperCase());
  if (!record) return { error: "ไม่พบห้องนี้ ตรวจสอบรหัสห้องอีกครั้ง" };
  const { room } = record;

  // Coming back to a seat already held — a refresh, or a dropped connection.
  // This is checked before the "room is full" rule, or reloading the page
  // during a match would lock you out of your own game.
  const existing = room.players.find((p) => p.id === playerId);
  if (existing) {
    existing.connected = true;
    existing.name = playerName || existing.name;
    record.lastNames[existing.seat] = existing.name;
    playerRoom.set(playerId, room.code);
    keepAlive(record);
    clearForfeitTimer(record); // back in time — the other side stops waiting
    return record;
  }

  if (room.players.length >= room.maxPlayers) return { error: "ห้องเต็มแล้ว" };
  if (room.inMatch) return { error: "ห้องนี้เริ่มเกมไปแล้ว" };

  const taken = new Set(room.players.map((p) => p.seat));
  const seat = SEATS.find((s) => !taken.has(s));
  if (!seat) return { error: "ห้องเต็มแล้ว" };

  // Certain of a seat here now, so the old one can go. Done after the checks
  // above rather than before them: someone who bounces off a full room should
  // still be sitting where they were.
  vacatePreviousRoom(playerId, record);

  room.players.push({ id: playerId, name: playerName, seat, isHost: false, connected: true });
  record.lastNames[seat] = playerName;
  playerRoom.set(playerId, room.code);
  keepAlive(record);

  if (room.players.length === room.maxPlayers && room.status === "waiting") {
    // "playing" here means the lobby is full and the game can be started —
    // `inMatch` is what says a match is actually on the table.
    room.status = "playing";
  }

  return record;
}

export function getRoom(roomCode: string): RoomRecord | undefined {
  return rooms.get(roomCode.toUpperCase());
}

export function getRoomForPlayer(playerId: string): RoomRecord | undefined {
  const code = playerRoom.get(playerId);
  return code ? rooms.get(code) : undefined;
}

export function seatOf(record: RoomRecord, playerId: string): Seat | null {
  return record.room.players.find((p) => p.id === playerId)?.seat ?? null;
}

export function nameOf(record: RoomRecord, seat: Seat): string {
  return record.room.players.find((p) => p.seat === seat)?.name ?? record.lastNames[seat] ?? seat;
}

/** Names and connection state by seat, for labelling the two sides. */
export function seatInfo(record: RoomRecord): {
  names: Record<string, string>;
  connected: Record<string, boolean>;
} {
  const names: Record<string, string> = {};
  const connected: Record<string, boolean> = {};
  for (const seat of SEATS) {
    const player = record.room.players.find((p) => p.seat === seat);
    names[seat] = player?.name ?? record.lastNames[seat] ?? seat;
    connected[seat] = player?.connected ?? false;
  }
  return { names, connected };
}

/**
 * Takes a seat's deck for the coming match. Returns an error message, or null.
 *
 * The deck is checked here rather than trusted: a client can send whatever
 * it likes down a socket, and a 60-card deck or one holding another
 * character's cards would deal a match nobody agreed to play.
 */
export function submitDeck(record: RoomRecord, seat: Seat, deck: DeckList): string | null {
  if (record.room.inMatch) return "เกมเริ่มไปแล้ว";
  const issues = deckIssues(deck);
  if (issues.length > 0) return issues.join("; ");

  record.decks[seat] = deck;
  record.room.picks[seat] = [...deck.characters];
  return null;
}

/**
 * Deals a match to the two seats. Returns an error message, or null on success.
 *
 * Both seats need a pick, and both need to be sat in; a match dealt to an
 * empty seat would have nobody to answer its questions.
 */
export function startMatch(record: RoomRecord): string | null {
  const { room } = record;
  if (room.players.length < MAX_PLAYERS) return "ยังรอผู้เล่นอีกคน";

  const decks = {} as Record<Seat, DeckList>;
  for (const seat of SEATS) {
    const deck = record.decks[seat];
    if (!deck) return `${nameOf(record, seat)} ยังไม่ได้เลือกเด็ค`;
    decks[seat] = deck;
  }

  record.seed = (record.seed + 1) >>> 0;
  try {
    record.session = MatchSession.deal(`${room.code}-${record.seed}`, decks, record.seed);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  clearForfeitTimer(record); // a fresh deal, so any stray countdown is stale
  clearActivityTimer(record);
  room.inMatch = true;
  room.status = "playing";
  refreshMatchActivity(record);
  return null;
}

/**
 * The rooms a browsing player may join: public, not full, not already
 * playing. Private rooms are reachable by code alone and never listed.
 */
export function publicRooms(): RoomSummary[] {
  const out: RoomSummary[] = [];
  for (const record of rooms.values()) {
    const { room } = record;
    if (room.visibility !== "public" || room.inMatch) continue;
    if (room.players.length >= room.maxPlayers) continue;
    if (!room.players.some((p) => p.connected)) continue;
    out.push({
      code: room.code,
      hostName: room.players.find((p) => p.isHost)?.name ?? room.players[0]?.name ?? "?",
      players: room.players.length,
      maxPlayers: room.maxPlayers,
      picks: room.players.map((p) => room.picks[p.seat] ?? []),
    });
  }
  return out;
}

/**
 * What the server is carrying right now — for the deploy script, which waits
 * for this to go quiet before restarting.
 *
 * `matches` counts only matches still being played: `room.inMatch` stays true
 * after a win so the final board keeps showing, and a restart that lands on
 * two people reading a result they have already seen costs them nothing. One
 * that lands mid-turn costs them the game.
 */
export function roomLoad(): { rooms: number; matches: number; players: number } {
  let matches = 0;
  let players = 0;
  for (const record of rooms.values()) {
    if (record.room.inMatch && record.session && !record.session.winnerId) matches += 1;
    players += record.room.players.filter((p) => p.connected).length;
  }
  return { rooms: rooms.size, matches, players };
}

export function endMatch(record: RoomRecord): void {
  clearForfeitTimer(record);
  clearActivityTimer(record);
  record.session = null;
  record.room.inMatch = false;
  record.room.status = record.room.players.length >= MAX_PLAYERS ? "playing" : "waiting";
}

export function addChat(record: RoomRecord, from: string, text: string): ChatMessage {
  const message: ChatMessage = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    from,
    text,
    at: Date.now(),
  };
  record.chat.push(message);
  if (record.chat.length > CHAT_LIMIT) record.chat.splice(0, record.chat.length - CHAT_LIMIT);
  return message;
}

function keepAlive(record: RoomRecord): void {
  if (record.reapTimer) {
    clearTimeout(record.reapTimer);
    record.reapTimer = null;
  }
}

function reapLater(record: RoomRecord): void {
  keepAlive(record);
  record.reapTimer = setTimeout(() => {
    // Check again on the way out: someone may have come back and left again.
    if (record.room.players.every((p) => !p.connected)) {
      clearActivityTimer(record);
      for (const player of record.room.players) playerRoom.delete(player.id);
      rooms.delete(record.room.code);
    }
  }, emptyRoomGraceMs);
  // Don't hold the process open just to throw a room away.
  record.reapTimer.unref?.();
}

function clearForfeitTimer(record: RoomRecord): void {
  if (record.forfeitTimer) {
    clearTimeout(record.forfeitTimer);
    record.forfeitTimer = null;
  }
}

function clearActivityTimer(record: RoomRecord): void {
  if (record.activityTimer) {
    clearTimeout(record.activityTimer);
    record.activityTimer = null;
  }
}

/**
 * Records one accepted gameplay operation.
 *
 * Intent/answer/cancel handlers call this only after MatchSession reports
 * success. Chat, reconnecting and invalid clicks deliberately do NOT extend
 * the timer — otherwise an abandoned match could block deploy forever while
 * somebody merely keeps a tab open or sends messages.
 */
export function refreshMatchActivity(record: RoomRecord): void {
  clearActivityTimer(record);
  if (!record.room.inMatch || !record.session || record.session.winnerId) return;

  record.activityTimer = setTimeout(() => {
    record.activityTimer = null;
    // Timers are stale by nature: a restart, leave, forfeit, deletion or a
    // later accepted move may have replaced this state before it fired.
    if (rooms.get(record.room.code) !== record) return;
    if (!record.room.inMatch || !record.session || record.session.winnerId) return;

    clearForfeitTimer(record);
    record.session.expireForInactivity();
    onExpiry?.(record);
  }, matchInactivityMs);
  // An idle timer should never keep a server alive by itself.
  record.activityTimer.unref?.();
}

/**
 * Starts (or restarts) the countdown to declaring `seat` gone for good.
 *
 * Only makes sense while a match is actually running and undecided — no
 * point timing out a lobby, or a match that already has a winner.
 */
function scheduleForfeit(record: RoomRecord, seat: Seat): void {
  clearForfeitTimer(record);
  if (!record.room.inMatch || !record.session || record.session.winnerId) return;

  record.forfeitTimer = setTimeout(() => {
    record.forfeitTimer = null;
    // Re-check everything on the way out: they may have reconnected, the
    // match may already be over, or the room may have been torn down —
    // any of that makes this a no-op rather than a stale forfeit.
    const player = record.room.players.find((p) => p.seat === seat);
    if (player?.connected) return;
    if (!record.room.inMatch || !record.session || record.session.winnerId) return;

    record.session.forfeit(seat);
    clearActivityTimer(record);
    onForfeit?.(record);
  }, matchForfeitGraceMs);
  record.forfeitTimer.unref?.();
}

/**
 * Marks a player as disconnected rather than removing them, so a refresh
 * doesn't cost them their seat — or the match. Returns the room, if any.
 */
export function markPlayerDisconnected(playerId: string): RoomRecord | undefined {
  const record = getRoomForPlayer(playerId);
  if (!record) return undefined;
  const player = record.room.players.find((p) => p.id === playerId);
  if (player) player.connected = false;
  seatWentQuiet(record, player?.seat);
  return record;
}

/**
 * What a room does once one of its seats stops answering — whether that was
 * a socket closing or the sweep below noticing a seat nobody is attached to.
 */
function seatWentQuiet(record: RoomRecord, seat: Seat | undefined): void {
  if (record.room.players.every((p) => !p.connected)) {
    // Nobody is here to notice a forfeit — cancel one if the first of the
    // two had already started a countdown, or it would still fire later
    // and hand a "win" to a room with nobody left to see it. The empty-room
    // reap is what cleans this up instead.
    clearForfeitTimer(record);
    clearActivityTimer(record);
    reapLater(record);
  } else if (seat) {
    // Someone is still around, waiting on a match that just went quiet on
    // one side. Give the other seat a chance to reconnect before it ends
    // the match on their behalf.
    scheduleForfeit(record, seat);
  }
}

/**
 * Drops rooms that nothing is really connected to any more.
 *
 * Every other path that marks a seat gone runs off a socket event, so a room
 * whose player vanished in a way no event described — the bug
 * `vacatePreviousRoom` now prevents, a handler that threw before it got
 * there, anything of that shape still to come — stayed "connected" forever
 * with no second chance to notice. This is the backstop: for every seat a
 * room believes is live, it asks whether a socket is genuinely open for that
 * player, and treats a "no" exactly like a disconnect. Nothing is deleted on
 * the spot; the usual empty-room grace period still has to run out, so a
 * match is never pulled out from under someone mid-reconnect.
 *
 * Returns the rooms it changed, so the caller can redraw them.
 */
export function sweepRooms(hasLiveSocket: (playerId: string) => boolean): RoomRecord[] {
  const changed: RoomRecord[] = [];
  for (const record of rooms.values()) {
    const ghosts = record.room.players.filter((p) => p.connected && !hasLiveSocket(p.id));
    if (ghosts.length === 0) continue;
    for (const ghost of ghosts) ghost.connected = false;
    // Marked every one of them before deciding what the room does about it:
    // seatWentQuiet chooses between "empty now, start the reap" and "one seat
    // left, start the other's forfeit clock", and taking that decision after
    // only the first of two ghosts would pick the wrong one.
    seatWentQuiet(record, ghosts[0].seat);
    changed.push(record);
  }
  return changed;
}

/**
 * A deliberate exit, which does give the seat up.
 *
 * Unlike a dropped connection, this needs no grace period — the player
 * chose to leave, so if a match was running it ends right there, in the
 * other seat's favour.
 */
export function leaveRoom(playerId: string): RoomRecord | undefined {
  const record = getRoomForPlayer(playerId);
  if (!record) return undefined;
  const seat = seatOf(record, playerId);

  if (record.room.inMatch && record.session && seat && !record.session.winnerId) {
    record.session.forfeit(seat);
  }
  clearForfeitTimer(record);
  clearActivityTimer(record);

  record.room.players = record.room.players.filter((p) => p.id !== playerId);
  playerRoom.delete(playerId);

  if (record.room.players.length === 0) {
    clearActivityTimer(record);
    keepAlive(record);
    rooms.delete(record.room.code);
    return record;
  }
  // Leaves `room.inMatch` as it is: a forfeited match should still show its
  // final board and winner to whoever is left, exactly like a match that
  // ended by someone's Life hitting zero already does. "เกมใหม่" (which
  // needs two seated players again) is the way back to a fresh game.
  record.room.status = "waiting";
  if (!record.room.players.some((p) => p.isHost)) record.room.players[0].isHost = true;
  return record;
}
