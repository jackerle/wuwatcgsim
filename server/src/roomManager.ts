import {
  MatchSession,
  SEATS,
  playableCharacters,
  type ChatMessage,
  type Player,
  type Room,
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
const EMPTY_ROOM_GRACE_MS = 5 * 60_000;

/** A room plus everything the server keeps for it that players never see raw. */
export interface RoomRecord {
  room: Room;
  session: MatchSession | null;
  chat: ChatMessage[];
  /** Bumped on every restart so a fresh deal is actually a fresh deal. */
  seed: number;
  reapTimer: NodeJS.Timeout | null;
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
  return { room, session: null, chat: [], seed: Math.floor(Math.random() * 1e9), reapTimer: null };
}

export function createRoom(playerId: string, playerName: string): RoomRecord {
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
    picks: {},
    inMatch: false,
  });
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
    playerRoom.set(playerId, room.code);
    keepAlive(record);
    return record;
  }

  if (room.players.length >= room.maxPlayers) return { error: "ห้องเต็มแล้ว" };
  if (room.inMatch) return { error: "ห้องนี้เริ่มเกมไปแล้ว" };

  const taken = new Set(room.players.map((p) => p.seat));
  const seat = SEATS.find((s) => !taken.has(s));
  if (!seat) return { error: "ห้องเต็มแล้ว" };

  room.players.push({ id: playerId, name: playerName, seat, isHost: false, connected: true });
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
  return record.room.players.find((p) => p.seat === seat)?.name ?? seat;
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
    names[seat] = player?.name ?? seat;
    connected[seat] = player?.connected ?? false;
  }
  return { names, connected };
}

export function pickCharacter(record: RoomRecord, seat: Seat, character: string): string | null {
  if (record.room.inMatch) return "เกมเริ่มไปแล้ว";
  if (!playableCharacters().includes(character)) return `ไม่มีตัวละครชื่อ ${character}`;
  record.room.picks[seat] = character;
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

  const picks = {} as Record<Seat, string>;
  for (const seat of SEATS) {
    const pick = room.picks[seat];
    if (!pick) return `${nameOf(record, seat)} ยังไม่ได้เลือกตัวละคร`;
    picks[seat] = pick;
  }

  record.seed = (record.seed + 1) >>> 0;
  try {
    record.session = MatchSession.deal(`${room.code}-${record.seed}`, picks, record.seed);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  room.inMatch = true;
  room.status = "playing";
  return null;
}

export function endMatch(record: RoomRecord): void {
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
      for (const player of record.room.players) playerRoom.delete(player.id);
      rooms.delete(record.room.code);
    }
  }, EMPTY_ROOM_GRACE_MS);
  // Don't hold the process open just to throw a room away.
  record.reapTimer.unref?.();
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

  if (record.room.players.every((p) => !p.connected)) reapLater(record);
  return record;
}

/** A deliberate exit, which does give the seat up. */
export function leaveRoom(playerId: string): RoomRecord | undefined {
  const record = getRoomForPlayer(playerId);
  if (!record) return undefined;
  record.room.players = record.room.players.filter((p) => p.id !== playerId);
  playerRoom.delete(playerId);

  if (record.room.players.length === 0) {
    keepAlive(record);
    rooms.delete(record.room.code);
    return record;
  }
  // Somebody walking out mid-match ends it; there is no one to play on with.
  if (record.room.inMatch) endMatch(record);
  record.room.status = "waiting";
  if (!record.room.players.some((p) => p.isHost)) record.room.players[0].isHost = true;
  return record;
}
