// The waiting room: who is here, which deck each of you is bringing, and the
// host's start button.
//
// Choosing a deck is a real submission, not a local selection — the server
// checks it with the same deckIssues() the builder does and keeps it until
// the match is dealt, so what it publishes back is only the three character
// names, never the 40 cards.

import { useState } from "react";
import { isDeckPlayable, type DeckList, type Room } from "@wuwatcg/shared";
import { socket } from "../socket";
import { DeckManager } from "../decks/DeckManager";
import { loadDecks, rememberDeckId, rememberedDeckId } from "../decks/storage";
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
  const [picking, setPicking] = useState(false);
  const [deck, setDeck] = useState<DeckList | null>(null);
  const [deckError, setDeckError] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);

  const player = room.players.find((p) => p.id === me);
  const isHost = player?.isHost ?? false;
  const both = room.players.length === room.maxPlayers;
  const ready = both && room.picks.p1 && room.picks.p2;

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
        title="เลือกเด็คที่จะใช้"
        pickedId={deck?.id ?? rememberedDeckId()}
        onPick={submit}
        onBack={() => setPicking(false)}
      />
    );
  }

  const saved = loadDecks();
  const playable = saved.filter(isDeckPlayable);

  return (
    <main className="page play-page">
      <div className="play-panel">
        <div className="play-head">
          <h1>ห้อง {room.code}</h1>
          <span className="play-spacer" />
          <span className="room-row-sub">
            {room.visibility === "public" ? "สาธารณะ" : "ส่วนตัว"}
          </span>
          <button type="button" onClick={onLeave}>
            ออกจากห้อง
          </button>
        </div>

        <section className="play-card">
          <h2>{both ? "ผู้เล่นครบแล้ว" : "รอผู้เล่นอีกคน"}</h2>
          {!both && (
            <p className="play-empty" style={{ textAlign: "left", padding: 0 }}>
              บอกรหัสห้อง <span className="room-code">{room.code}</span> ให้เพื่อน
              {room.visibility === "public" && " หรือรอให้ใครสักคนเจอห้องนี้ในลิสต์"}
            </p>
          )}
          {room.players.map((p) => {
            const picks = room.picks[p.seat] ?? [];
            return (
              <div key={p.id} className="room-row">
                <div className="room-row-main">
                  <div className="room-row-host">
                    {p.name}
                    {p.isHost && " (host)"}
                    {p.id === me && " (คุณ)"}
                  </div>
                  <div className="room-row-sub">
                    {picks.length > 0 ? picks.join(" · ") : "ยังไม่ได้เลือกเด็ค"}
                    {!p.connected && " — หลุดการเชื่อมต่อ"}
                  </div>
                </div>
                <span className={`deck-row-badge ${picks.length > 0 ? "ok" : ""}`}>
                  {picks.length > 0 ? "พร้อม" : "รอ"}
                </span>
              </div>
            );
          })}
        </section>

        <section className="play-card">
          <h2>เด็คของคุณ</h2>
          {deck ? (
            <div className="room-row">
              <div className="room-row-main">
                <div className="room-row-host">{deck.name}</div>
                <div className="room-row-sub">{deck.characters.join(" · ")}</div>
              </div>
              <button type="button" onClick={() => setPicking(true)}>
                เปลี่ยน
              </button>
            </div>
          ) : (
            <div className="play-row">
              <button type="button" className="primary" onClick={() => setPicking(true)}>
                {playable.length > 0 ? "เลือกเด็ค" : "จัดเด็คก่อน"}
              </button>
              <span className="room-row-sub">
                {playable.length > 0
                  ? `มีเด็คที่เล่นได้ ${playable.length} เด็ค`
                  : "ยังไม่มีเด็คที่ครบ 40 ใบ"}
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
            title={ready ? undefined : "ต้องมีผู้เล่นสองคนและเลือกเด็คครบทั้งคู่"}
            onClick={() =>
              socket.emit("startMatch", (result) =>
                setStartError("error" in result ? result.error : null)
              )
            }
          >
            เริ่มเกม
          </button>
        ) : (
          <p className="play-empty">รอเจ้าของห้องกดเริ่มเกม</p>
        )}

        {(error || startError) && <p className="play-error">{error ?? startError}</p>}
      </div>
    </main>
  );
}
