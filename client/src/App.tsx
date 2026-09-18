import { useCallback, useEffect, useRef, useState } from "react";
import type { Room, RoomVisibility, Seat } from "@wuwatcg/shared";
import { socket } from "./socket";
import { playerId, rememberName, rememberRoom, rememberedName, rememberedRoom } from "./identity";
import { clearMatch } from "./game/matchStore";
import { HotseatGame } from "./game/HotseatGame";
import { NetGame } from "./game/NetGame";
import { MainMenu } from "./menu/MainMenu";
import { PlayMenu } from "./menu/PlayMenu";
import { DeckManager } from "./decks/DeckManager";
import { loadDecks } from "./decks/storage";
import { Lobby } from "./menu/Lobby";
import "./App.css";

const ME = playerId();

/** Which screen is up. A room or a running match overrides this entirely. */
type Screen = "menu" | "play" | "decks";

export default function App() {
  const [screen, setScreen] = useState<Screen>("menu");
  const [playerName, setPlayerName] = useState(rememberedName);
  const [room, setRoom] = useState<Room | null>(null);
  const [seat, setSeat] = useState<Seat | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hotseat, setHotseat] = useState(false);
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

  // And again on every reconnect, not just the first load.
  //
  // A backgrounded tab gets its socket dropped, and Socket.IO comes back on a
  // NEW socket. The server tracks the room per SOCKET, so that fresh one is
  // sitting in no room at all: the board still shows, every click is sent,
  // and the server has nowhere to put it. Rejoining is what re-attaches it —
  // joinRoom already knows a returning player id and hands the seat straight
  // back, match in progress and all.
  useEffect(() => {
    const onConnect = () => {
      const code = rememberedRoom();
      if (code) join(code, rememberedName() || "Player", true);
    };
    socket.on("connect", onConnect);
    return () => {
      socket.off("connect", onConnect);
    };
  }, [join]);

  const createRoom = useCallback(
    (visibility: RoomVisibility) => {
      setError(null);
      rememberName(playerName);
      socket.emit("createRoom", { playerName, playerId: ME, visibility }, (result) => {
        if ("error" in result) {
          setError(result.error);
          return;
        }
        setRoom(result.room);
        setSeat(result.seat);
        rememberRoom(result.room.code);
      });
    },
    [playerName]
  );

  const leaveRoom = useCallback(() => {
    if (room) socket.emit("leaveRoom", { roomCode: room.code });
    clearMatch();
    rememberRoom(null);
    setRoom(null);
    setSeat(null);
    setScreen("play");
  }, [room]);

  // ?play still opens a hotseat game straight off, which is how the board gets
  // exercised without needing a second person or a server.
  const params = new URLSearchParams(location.search);
  if (hotseat || params.has("play") || params.has("boardPreview")) {
    return (
      <main className="page board-page">
        <HotseatGame picks={{ p1: params.get("you") ?? "Camellya", p2: params.get("vs") ?? "Encore" }} />
      </main>
    );
  }

  if (room?.inMatch && seat) {
    const isHost = room.players.find((p) => p.id === ME)?.isHost ?? false;
    return (
      <main className="page board-page">
        <NetGame isHost={isHost} onLeave={leaveRoom} />
      </main>
    );
  }

  if (room && seat) {
    return <Lobby room={room} me={ME} error={error} onLeave={leaveRoom} />;
  }

  if (screen === "decks") {
    return <DeckManager onBack={() => setScreen("menu")} />;
  }

  if (screen === "play") {
    return (
      <PlayMenu
        error={error}
        onBack={() => {
          setError(null);
          setScreen("menu");
        }}
        onJoin={(code) => {
          rememberName(playerName);
          join(code, playerName || "Player");
        }}
        onCreate={createRoom}
      />
    );
  }

  return (
    <MainMenu
      playerName={playerName}
      deckCount={loadDecks().length}
      onNameChange={(name) => {
        setPlayerName(name);
        rememberName(name);
      }}
      onPlay={() => {
        setError(null);
        setScreen("play");
      }}
      onDecks={() => setScreen("decks")}
      onHotseat={() => setHotseat(true)}
    />
  );
}
