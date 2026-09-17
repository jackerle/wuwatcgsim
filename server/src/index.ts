import { createServer } from "node:http";
import cors from "cors";
import express from "express";
import { Server } from "socket.io";
import type {
  ClientToServerEvents,
  InterServerEvents,
  ServerToClientEvents,
  SocketData,
} from "@wuwatcg/shared";
import { playableCharacters } from "@wuwatcg/shared";
import {
  addChat,
  createRoom,
  endMatch,
  getRoom,
  getRoomForPlayer,
  joinRoom,
  leaveRoom,
  markPlayerDisconnected,
  publicRooms,
  seatInfo,
  seatOf,
  startMatch,
  submitDeck,
  type RoomRecord,
} from "./roomManager.js";

const PORT = Number(process.env.PORT ?? 3001);
// Comma-separated, so a phone on the LAN can be let in without a rebuild.
const CLIENT_ORIGIN = (process.env.CLIENT_ORIGIN ?? "http://localhost:5173")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const app = express();
app.use(cors({ origin: CLIENT_ORIGIN }));
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ ok: true, characters: playableCharacters() });
});

const httpServer = createServer(app);

const io = new Server<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>(httpServer, {
  cors: { origin: CLIENT_ORIGIN },
});

/**
 * Sends every seated player their own view of the match.
 *
 * Each one is built separately: a MatchState carries both hands, and the
 * filtering that keeps one out of the other's view happens here, before
 * anything leaves the process. A client cannot leak what it never received.
 */
function emitMatch(record: RoomRecord): void {
  const session = record.session;
  if (!session) return;
  const { names, connected } = seatInfo(record);

  for (const player of record.room.players) {
    const update = session.updateFor(player.seat);
    io.to(player.id).emit("matchUpdate", {
      matchId: session.state.matchId,
      seat: player.seat,
      names,
      connected,
      ...update,
    });
  }
}

function emitRoom(record: RoomRecord): void {
  io.to(record.room.code).emit("roomUpdate", record.room);
}

/**
 * The room browser's channel. Only sockets that asked to browse are in it,
 * so a match in progress never pays for someone else's lobby refresh.
 */
const LOBBY = "lobby";

function emitRooms(): void {
  io.to(LOBBY).emit("roomsUpdate", publicRooms());
}

/**
 * Live sockets per player.
 *
 * A refresh opens the new socket before the old one's `disconnect` always
 * arrives, so "this socket closed" does not mean "this player left". Only
 * the last socket for a player closing counts as a disconnect.
 */
const socketsFor = new Map<string, Set<string>>();

function trackSocket(playerId: string, socketId: string): void {
  const open = socketsFor.get(playerId) ?? new Set<string>();
  open.add(socketId);
  socketsFor.set(playerId, open);
}

/** Returns true if that was the player's last open socket. */
function untrackSocket(playerId: string, socketId: string): boolean {
  const open = socketsFor.get(playerId);
  if (!open) return true;
  open.delete(socketId);
  if (open.size > 0) return false;
  socketsFor.delete(playerId);
  return true;
}

/** The room a socket is sat in, or null if it has not joined one. */
function recordFor(socket: { data: SocketData }): RoomRecord | null {
  const playerId = socket.data.playerId;
  if (!playerId) return null;
  return getRoomForPlayer(playerId) ?? null;
}

io.on("connection", (socket) => {
  socket.data.roomCode = null;
  socket.data.playerId = "";

  /** Joins the socket to its room channel and its own private channel. */
  function attach(record: RoomRecord, playerId: string): void {
    socket.data.playerId = playerId;
    socket.data.roomCode = record.room.code;
    socket.join(record.room.code);
    // A per-player channel, so one seat's view of the board goes only to
    // that seat — across however many tabs they happen to have open.
    socket.join(playerId);
    trackSocket(playerId, socket.id);
  }

  socket.on("createRoom", ({ playerName, playerId, visibility }, callback) => {
    const id = playerId || socket.id;
    const record = createRoom(id, playerName.trim() || "Player", visibility);
    attach(record, id);
    callback({ room: record.room, seat: record.room.players[0].seat, playerId: id });
    emitRooms();
  });

  socket.on("joinRoom", ({ roomCode, playerName, playerId }, callback) => {
    const id = playerId || socket.id;
    const result = joinRoom(roomCode, id, playerName.trim() || "Player");
    if ("error" in result) {
      callback({ error: result.error });
      return;
    }
    const seat = seatOf(result, id);
    if (!seat) {
      callback({ error: "ไม่สามารถจองที่นั่งได้" });
      return;
    }
    attach(result, id);
    callback({ room: result.room, seat, playerId: id });
    emitRoom(result);
    // The room may have just filled up, which takes it off the browser.
    emitRooms();
    socket.emit("chatHistory", result.chat);
    // A rejoin lands mid-match: hand the board straight back rather than
    // making them wait for the other player's next move to redraw it.
    if (result.session) emitMatch(result);
  });

  socket.on("leaveRoom", ({ roomCode }) => {
    const record = leaveRoom(socket.data.playerId);
    untrackSocket(socket.data.playerId, socket.id);
    socket.leave(roomCode);
    socket.leave(socket.data.playerId);
    socket.data.roomCode = null;
    if (record && record.room.players.length > 0) {
      emitRoom(record);
      io.to(record.room.code).emit("matchEnded");
    }
    emitRooms();
  });

  socket.on("watchRooms", ({ watching }) => {
    if (watching) {
      socket.join(LOBBY);
      socket.emit("roomsUpdate", publicRooms());
    } else {
      socket.leave(LOBBY);
    }
  });

  socket.on("submitDeck", ({ deck }, callback) => {
    const record = recordFor(socket);
    const seat = record && seatOf(record, socket.data.playerId);
    if (!record || !seat) {
      callback({ error: "ยังไม่ได้อยู่ในห้อง" });
      return;
    }
    const error = submitDeck(record, seat, deck);
    if (error) {
      callback({ error });
      return;
    }
    callback({ ok: true });
    emitRoom(record);
    emitRooms();
  });

  socket.on("startMatch", (callback) => {
    const record = recordFor(socket);
    if (!record) {
      callback({ error: "ยังไม่ได้อยู่ในห้อง" });
      return;
    }
    const host = record.room.players.find((p) => p.id === socket.data.playerId);
    if (!host?.isHost) {
      callback({ error: "เฉพาะเจ้าของห้องเท่านั้นที่เริ่มเกมได้" });
      return;
    }
    const error = startMatch(record);
    if (error) {
      callback({ error });
      return;
    }
    callback({ ok: true });
    emitRoom(record);
    emitMatch(record);
    // A room that just started playing drops off the browser.
    emitRooms();
  });

  socket.on("matchIntent", ({ intent }) => {
    const record = recordFor(socket);
    const seat = record && seatOf(record, socket.data.playerId);
    if (!record?.session || !seat) return;
    record.session.apply(seat, intent);
    emitMatch(record);
  });

  socket.on("matchAnswer", ({ answer }) => {
    const record = recordFor(socket);
    const seat = record && seatOf(record, socket.data.playerId);
    if (!record?.session || !seat) return;
    record.session.answer(seat, answer);
    emitMatch(record);
  });

  socket.on("cancelChoice", () => {
    const record = recordFor(socket);
    const seat = record && seatOf(record, socket.data.playerId);
    if (!record?.session || !seat) return;
    record.session.cancel(seat);
    emitMatch(record);
  });

  socket.on("restartMatch", () => {
    const record = recordFor(socket);
    if (!record) return;
    endMatch(record);
    const error = startMatch(record);
    if (error) {
      socket.emit("errorMessage", { message: error });
      emitRoom(record);
      return;
    }
    emitRoom(record);
    emitMatch(record);
  });

  socket.on("sendChat", ({ text }) => {
    const record = recordFor(socket);
    if (!record) return;
    const trimmed = text.trim().slice(0, 300);
    if (!trimmed) return;
    const from = record.room.players.find((p) => p.id === socket.data.playerId)?.name ?? "?";
    io.to(record.room.code).emit("chatMessage", addChat(record, from, trimmed));
  });

  socket.on("disconnect", () => {
    const { roomCode, playerId } = socket.data;
    if (!roomCode || !playerId) return;
    if (!untrackSocket(playerId, socket.id)) return;
    const record = markPlayerDisconnected(playerId);
    if (record) emitRoom(record);
    emitRooms();
  });
});

// Exported for tests / reuse; not required for `npm run dev`.
export { app, io, getRoom };

httpServer.listen(PORT, () => {
  console.log(`WuwaTCGSim server listening on http://localhost:${PORT}`);
});
