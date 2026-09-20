import { useCallback, useEffect, useRef, useState } from "react";
import type { Room, RoomVisibility, Seat } from "@wuwatcg/shared";
// Imported before any component below so the base `.page` rule it defines
// loses the cascade to each screen's own CSS (MainMenu.css, DeckBuilder.css,
// ...) when they redeclare the same properties on `.page`'s sibling class —
// e.g. `.deck-page` overriding `.page`'s centered flex layout with a plain
// block one. Both selectors carry equal specificity, so whichever rule's
// stylesheet loads later wins; imported here first, App.css always loads
// first regardless of the order the screens below happen to be imported in.
import "./App.css";
import { socket } from "./socket";
import { playerId, rememberName, rememberRoom, rememberedName, rememberedRoom } from "./identity";
import { clearMatch } from "./game/matchStore";
import { HotseatGame } from "./game/HotseatGame";
import { BotGame } from "./game/BotGame";
import { NetGame } from "./game/NetGame";
import { MainMenu } from "./menu/MainMenu";
import { PlayMenu } from "./menu/PlayMenu";
import { DeckManager } from "./decks/DeckManager";
import { allDecks } from "./decks/storage";
import { Lobby } from "./menu/Lobby";
import { warmCardImages } from "./board/imagePreload";
import {
  isVsBotPath,
  pathForScreen,
  screenFromPath,
  VS_BOT_PATH,
  type Screen,
} from "./routing";

const ME = playerId();

export default function App() {
  const [screen, setScreenState] = useState<Screen>(() => screenFromPath(location.pathname));
  const [vsBot, setVsBotState] = useState(() => isVsBotPath(location.pathname));
  // Wraps the raw setter so every screen change also lands in browser
  // history — a real Back press then just re-fires this same setter via the
  // popstate listener below, instead of screen state and the address bar
  // being two things that can drift apart.
  const setScreen = useCallback((next: Screen) => {
    setScreenState(next);
    const path = pathForScreen(next);
    if (location.pathname !== path) history.pushState({ screen: next }, "", path);
  }, []);
  // The bot match is an override, not one of the three Screen paths: it gets
  // its own path so it can come and go from the address bar, and Back leaves
  // it the way Back leaves any screen.
  const setVsBot = useCallback((on: boolean) => {
    setVsBotState(on);
    const path = on ? VS_BOT_PATH : pathForScreen("menu");
    if (location.pathname !== path) history.pushState({}, "", path);
  }, []);

  useEffect(() => {
    const onPopState = () => {
      setScreenState(screenFromPath(location.pathname));
      setVsBotState(isVsBotPath(location.pathname));
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const [playerName, setPlayerName] = useState(rememberedName);
  const [room, setRoom] = useState<Room | null>(null);
  const [seat, setSeat] = useState<Seat | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Stops the refresh-rejoin from firing again on every reconnect. */
  const rejoined = useRef(false);
  /**
   * One room request in flight at a time.
   *
   * Nothing used to stop a second "create room" while the first was still on
   * its way. On a slow connection a player taps again because nothing seems
   * to be happening — and every tap opened a real room on the server, while
   * only the last answer was the one they landed in. The rooms in between
   * were left standing in the public list with nobody in them.
   *
   * The ref is what actually guards: two clicks can land before React has
   * re-rendered the button as disabled, and a ref is already true by the
   * second one.
   */
  const [busy, setBusy] = useState(false);
  const busy_ = useRef(false);
  const busyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const endRequest = useCallback(() => {
    if (busyTimer.current) {
      clearTimeout(busyTimer.current);
      busyTimer.current = null;
    }
    busy_.current = false;
    setBusy(false);
  }, []);

  /** Takes the lock, or returns false if a request is already running. */
  const beginRequest = useCallback(() => {
    if (busy_.current) return false;
    busy_.current = true;
    setBusy(true);
    // A socket that drops mid-request never calls its ack back at all;
    // without this the buttons would stay dead until the page was reloaded.
    busyTimer.current = setTimeout(endRequest, 10_000);
    return true;
  }, [endRequest]);

  // Starts loading every card image once, in the background, as soon as the
  // app opens — by the time a screen actually needs one (deck building, a
  // match preview) it's usually already sitting in the browser's cache
  // instead of stalling that screen's first hover on the network.
  useEffect(() => {
    warmCardImages();
  }, []);

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

  const join = useCallback(
    (code: string, name: string, quiet = false) => {
      // The quiet rejoin fires off a reconnect rather than a click: it is not
      // a button to protect, and it must not be blocked by one.
      if (!quiet && !beginRequest()) return;
      socket.emit("joinRoom", { roomCode: code, playerName: name, playerId: ME }, (result) => {
        if (!quiet) endRequest();
        if ("error" in result) {
          // A silent rejoin that fails just means the room is gone; don't
          // shout about it on a page the player opened fresh.
          if (!quiet) setError(result.error);
          rememberRoom(null);
          // There is no seat to go back to, so stop showing one. Without
          // this the player was left on a board that would never update
          // again, with no way out but a reload — which is exactly what
          // every server restart used to do to everyone mid-match.
          setRoom(null);
          setSeat(null);
          clearMatch();
          return;
        }
        setError(null);
        setRoom(result.room);
        setSeat(result.seat);
        rememberRoom(result.room.code);
      });
    },
    [beginRequest, endRequest]
  );

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
      if (!beginRequest()) return;
      setError(null);
      rememberName(playerName);
      socket.emit("createRoom", { playerName, playerId: ME, visibility }, (result) => {
        endRequest();
        if ("error" in result) {
          setError(result.error);
          return;
        }
        setRoom(result.room);
        setSeat(result.seat);
        rememberRoom(result.room.code);
      });
    },
    [playerName, beginRequest, endRequest]
  );

  const leaveRoom = useCallback(() => {
    if (room) socket.emit("leaveRoom", { roomCode: room.code });
    clearMatch();
    rememberRoom(null);
    setRoom(null);
    setSeat(null);
    setScreen("play");
  }, [room, setScreen]);

  // A hidden ?play / ?boardPreview query hatch still opens a two-seat board
  // straight off — it is how the board gets exercised without a second person
  // or a server. It is deliberately not surfaced in the menu; the "play both
  // sides" entry was removed, so this stays for development only.
  const params = new URLSearchParams(location.search);
  if (params.has("play") || params.has("boardPreview")) {
    return (
      <main className="page board-page">
        <HotseatGame picks={{ p1: params.get("you") ?? "Camellya", p2: params.get("vs") ?? "Encore" }} />
      </main>
    );
  }

  // Checked before a room, but after the dev board hatch, for the same reason
  // that hatch is where it is: neither one involves the server, so neither can
  // be holding a seat somebody else is waiting on.
  if (vsBot) {
    return <BotGame onBack={() => setVsBot(false)} />;
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
        busy={busy}
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
      deckCount={allDecks().length}
      onNameChange={(name) => {
        setPlayerName(name);
        rememberName(name);
      }}
      onPlay={() => {
        setError(null);
        setScreen("play");
      }}
      onDecks={() => setScreen("decks")}
      onVsBot={() => setVsBot(true)}
    />
  );
}
