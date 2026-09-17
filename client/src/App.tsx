import { useCallback, useEffect, useRef, useState } from "react";
import { playableCharacters, type Room, type Seat } from "@wuwatcg/shared";
import { socket } from "./socket";
import { playerId, rememberName, rememberRoom, rememberedName, rememberedRoom } from "./identity";
import { clearMatch } from "./game/matchStore";
import { HotseatGame } from "./game/HotseatGame";
import { NetGame } from "./game/NetGame";
import "./App.css";

const CHARACTERS = playableCharacters();
const ME = playerId();

export default function App() {
  const [playerName, setPlayerName] = useState(rememberedName);
  const [joinCode, setJoinCode] = useState("");
  const [room, setRoom] = useState<Room | null>(null);
  const [seat, setSeat] = useState<Seat | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Stops the refresh-rejoin from firing again on every reconnect. */
  const rejoined = useRef(false);

  useEffect(() => {
    const onRoomUpdate = (updated: Room) => {
      setRoom((prev) => (prev && prev.code === updated.code ? updated : prev));
    };
    const onError = ({ message }: { message: string }) => setError(message);
    socket.on("roomUpdate", onRoomUpdate);
    socket.on("errorMessage", onError);
    return () => {
      socket.off("roomUpdate", onRoomUpdate);
      socket.off("errorMessage", onError);
    };
  }, []);

  const join = useCallback((code: string, name: string, quiet = false) => {
    socket.emit("joinRoom", { roomCode: code, playerName: name, playerId: ME }, (result) => {
      if ("error" in result) {
        // A silent rejoin that fails just means the room is gone; don't shout
        // about it on a page the player opened fresh.
        if (!quiet) setError(result.error);
        rememberRoom(null);
        return;
      }
      setError(null);
      setRoom(result.room);
      setSeat(result.seat);
      rememberRoom(result.room.code);
    });
  }, []);

  // Walk back into the room this browser was in, if it is still there. Mostly
  // this is a refresh mid-match; the server keeps the seat for exactly this.
  useEffect(() => {
    if (rejoined.current) return;
    const code = rememberedRoom();
    if (!code) return;
    rejoined.current = true;
    join(code, rememberedName() || "Player", true);
  }, [join]);

  function handleCreateRoom() {
    setError(null);
    rememberName(playerName);
    socket.emit("createRoom", { playerName, playerId: ME }, (result) => {
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setRoom(result.room);
      setSeat(result.seat);
      rememberRoom(result.room.code);
    });
  }

  function handleJoinRoom() {
    rememberName(playerName);
    join(joinCode, playerName);
  }

  const handleLeaveRoom = useCallback(() => {
    if (room) socket.emit("leaveRoom", { roomCode: room.code });
    clearMatch();
    rememberRoom(null);
    setRoom(null);
    setSeat(null);
  }, [room]);

  // Open with ?play for a hotseat game on this screen alone — handy for
  // trying a card out without needing a second person.
  const params = new URLSearchParams(location.search);
  const hotseat = params.has("play") || params.has("boardPreview");

  if (hotseat) {
    return (
      <main className="page board-page">
        <HotseatGame
          picks={{
            p1: params.get("you") ?? CHARACTERS[0] ?? "Camellya",
            p2: params.get("vs") ?? CHARACTERS[1] ?? "Encore",
          }}
        />
      </main>
    );
  }

  if (room?.inMatch && seat) {
    const isHost = room.players.find((p) => p.id === ME)?.isHost ?? false;
    return (
      <main className="page board-page">
        <NetGame isHost={isHost} onLeave={handleLeaveRoom} />
      </main>
    );
  }

  if (room && seat) {
    return <Lobby room={room} seat={seat} error={error} onLeave={handleLeaveRoom} />;
  }

  return (
    <main className="page">
      <div className="card">
        <h1>WuWa TCG Simulator</h1>
        <label>
          ชื่อผู้เล่น
          <input
            value={playerName}
            onChange={(e) => setPlayerName(e.target.value)}
            placeholder="ใส่ชื่อของคุณ"
          />
        </label>

        <button type="button" onClick={handleCreateRoom} disabled={!playerName.trim()}>
          สร้างห้อง
        </button>

        <div className="divider">หรือ</div>

        <label>
          รหัสห้อง
          <input
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
            placeholder="เช่น AB12"
            maxLength={4}
          />
        </label>
        <button
          type="button"
          onClick={handleJoinRoom}
          disabled={!playerName.trim() || !joinCode.trim()}
        >
          เข้าร่วมห้อง
        </button>

        <p className="hint">
          <a href="?play">หรือเล่นคนเดียวสองฝั่งบนจอนี้</a>
        </p>

        {error && <p className="error">{error}</p>}
      </div>
    </main>
  );
}

/**
 * The waiting room: pick a character, and once both seats have picked, the
 * host deals. Picks are shown to both players — there is no advantage in
 * hiding which character someone brought, and seeing it is half the fun.
 */
function Lobby({
  room,
  seat,
  error,
  onLeave,
}: {
  room: Room;
  seat: Seat;
  error: string | null;
  onLeave: () => void;
}) {
  const [startError, setStartError] = useState<string | null>(null);
  const me = room.players.find((p) => p.id === ME);
  const ready = room.players.length === room.maxPlayers && room.picks.p1 && room.picks.p2;

  return (
    <main className="page">
      <div className="card">
        <h1>ห้อง {room.code}</h1>
        <p className="status">
          {room.players.length < room.maxPlayers
            ? "รอผู้เล่นอีกคน... บอกรหัสห้องให้เพื่อน"
            : "ผู้เล่นครบแล้ว — เลือกตัวละครได้เลย"}
        </p>

        <ul className="player-list">
          {room.players.map((p) => (
            <li key={p.id} className={p.connected ? "" : "disconnected"}>
              {p.name}
              {p.isHost && " (host)"}
              {p.id === ME && " (คุณ)"}
              {room.picks[p.seat] && ` — ${room.picks[p.seat]}`}
              {!p.connected && " — หลุดการเชื่อมต่อ"}
            </li>
          ))}
        </ul>

        <label>
          ตัวละครของคุณ
          <select
            value={room.picks[seat] ?? ""}
            onChange={(e) => socket.emit("pickCharacter", { character: e.target.value })}
          >
            <option value="" disabled>
              เลือกตัวละคร
            </option>
            {CHARACTERS.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>

        {me?.isHost ? (
          <button
            type="button"
            disabled={!ready}
            onClick={() =>
              socket.emit("startMatch", (result) =>
                setStartError("error" in result ? result.error : null)
              )
            }
          >
            เริ่มเกม
          </button>
        ) : (
          <p className="status">รอเจ้าของห้องกดเริ่มเกม</p>
        )}

        <button type="button" onClick={onLeave}>
          ออกจากห้อง
        </button>

        {(error || startError) && <p className="error">{error ?? startError}</p>}
      </div>
    </main>
  );
}
