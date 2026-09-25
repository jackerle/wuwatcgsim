// The waiting room: who is here, which deck each of you is bringing, and the
// host's start button.
//
// Choosing a deck is a real submission, not a local selection — the server
// checks it with the same deckIssues() the builder does and keeps it until
// the match is dealt, so what it publishes back is only THAT a seat is ready —
// not the deck's name, its characters or its 40 cards.

import { useState } from "react";
import { isDeckPlayable, type DeckList, type Room } from "@wuwatcg/shared";
import { socket } from "../socket";
import { DeckManager } from "../decks/DeckManager";
import { allDecks, rememberDeckId, rememberedDeckId } from "../decks/storage";
import { useLang } from "../i18n/LanguageContext";
import "./MainMenu.css";

export function Lobby({
  room,
  me,
  error,
  onLeave,
}: {
  room: Room;
  me: string;
  error: string | null;
  onLeave: () => void;
}) {
  const { t } = useLang();
  const [picking, setPicking] = useState(false);
  const player = room.players.find((p) => p.id === me);
  // Back from a rematch the server still holds this seat's deck, so show it
  // rather than asking again. The server keeps only the list, so it is found
  // again by the id remembered when it was handed in.
  const [deck, setDeck] = useState<DeckList | null>(() =>
    player && room.ready[player.seat]
      ? (allDecks().find((entry) => entry.id === rememberedDeckId()) ?? null)
      : null
  );
  const [deckError, setDeckError] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);

  const isHost = player?.isHost ?? false;
  const both = room.players.length === room.maxPlayers;
  const ready = both && room.ready.p1 && room.ready.p2;

  function submit(chosen: DeckList) {
    socket.emit("submitDeck", { deck: chosen }, (result) => {
      if ("error" in result) {
        setDeckError(result.error);
        return;
      }
      setDeckError(null);
      setDeck(chosen);
      rememberDeckId(chosen.id);
      setPicking(false);
    });
  }

  if (picking) {
    return (
      <DeckManager
        title={t("lobby.pickDeckTitle")}
        pickedId={deck?.id ?? rememberedDeckId()}
        onPick={submit}
        onBack={() => setPicking(false)}
      />
    );
  }

  // allDecks: the built-in decks are pickable for a match like any other, and
  // for a first-time player they are the ONLY ones — counting just the stored
  // ones here would offer "build a deck first" beside three ready to play.
  const playable = allDecks().filter(isDeckPlayable);

  return (
    <main className="page play-page">
      <div className="play-panel">
        <div className="play-head">
          <h1>{t("lobby.roomHeading", room.code)}</h1>
          <span className="play-spacer" />
          <span className="room-row-sub">
            {room.visibility === "public" ? t("lobby.visibilityPublic") : t("lobby.visibilityPrivate")}
          </span>
          <button type="button" onClick={onLeave}>
            {t("common.leaveRoom")}
          </button>
        </div>

        <section className="play-card">
          <h2>{both ? t("lobby.bothReady") : t("lobby.waitingForPlayer")}</h2>
          {!both && (
            <p className="play-empty" style={{ textAlign: "left", padding: 0 }}>
              {t("lobby.shareCodeBefore")} <span className="room-code">{room.code}</span>{" "}
              {t("lobby.shareCodeAfter")}
              {room.visibility === "public" && ` ${t("lobby.orWaitInList")}`}
            </p>
          )}
          {room.players.map((p) => {
            const isReady = Boolean(room.ready[p.seat]);
            return (
              <div key={p.id} className="room-row">
                <div className="room-row-main">
                  <div className="room-row-host">
                    {p.name}
                    {p.isHost && " (host)"}
                    {p.id === me && ` ${t("lobby.you")}`}
                  </div>
                  <div className="room-row-sub">
                    {isReady ? t("lobby.deckPicked") : t("lobby.noDeckPicked")}
                    {!p.connected && ` — ${t("lobby.disconnectedSuffix")}`}
                  </div>
                </div>
                <span className={`deck-row-badge ${isReady ? "ok" : ""}`}>
                  {isReady ? t("lobby.ready") : t("lobby.waiting")}
                </span>
              </div>
            );
          })}
        </section>

        <section className="play-card">
          <h2>{t("lobby.yourDeck")}</h2>
          {deck ? (
            <div className="room-row">
              <div className="room-row-main">
                <div className="room-row-host">{deck.name}</div>
                <div className="room-row-sub">{deck.characters.join(" · ")}</div>
              </div>
              <button type="button" onClick={() => setPicking(true)}>
                {t("lobby.change")}
              </button>
            </div>
          ) : (
            <div className="play-row">
              <button type="button" className="primary" onClick={() => setPicking(true)}>
                {playable.length > 0 ? t("lobby.chooseDeck") : t("lobby.buildDeckFirst")}
              </button>
              <span className="room-row-sub">
                {playable.length > 0 ? t("lobby.playableDeckCount", playable.length) : t("lobby.noFullDeck")}
              </span>
            </div>
          )}
          {deckError && <p className="play-error">{deckError}</p>}
        </section>

        {isHost ? (
          <button
            type="button"
            className="primary"
            disabled={!ready}
            title={ready ? undefined : t("lobby.needTwoPlayersTitle")}
            onClick={() =>
              socket.emit("startMatch", (result) =>
                setStartError("error" in result ? result.error : null)
              )
            }
          >
            {t("lobby.startGame")}
          </button>
        ) : (
          <p className="play-empty">{t("lobby.waitingForHost")}</p>
        )}

        {(error || startError) && <p className="play-error">{error ?? startError}</p>}
      </div>
    </main>
  );
}
