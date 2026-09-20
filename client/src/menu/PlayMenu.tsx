// Finding a game: the public rooms waiting for someone, a box for a private
// code, and a button to open a room of your own.
//
// The list is pushed by the server while this screen is open (watchRooms) and
// stops the moment it closes, so a match in progress never pays for someone
// else's browsing.

import { useEffect, useState } from "react";
import type { RoomSummary, RoomVisibility } from "@wuwatcg/shared";
import { socket } from "../socket";
import { useLang } from "../i18n/LanguageContext";
import "./MainMenu.css";

export function PlayMenu({
  onJoin,
  onCreate,
  onBack,
  error,
  busy,
}: {
  onJoin: (code: string) => void;
  onCreate: (visibility: RoomVisibility) => void;
  onBack: () => void;
  error: string | null;
  /**
   * A room request is already on its way. Every button that would start
   * another one goes dead until it comes back — a second "create room" while
   * the first is in flight opens a second room that nobody ever sits in.
   */
  busy: boolean;
}) {
  const { t } = useLang();
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [code, setCode] = useState("");
  const [visibility, setVisibility] = useState<RoomVisibility>("public");

  useEffect(() => {
    const onRooms = (next: RoomSummary[]) => setRooms(next);
    socket.on("roomsUpdate", onRooms);
    socket.emit("watchRooms", { watching: true });
    return () => {
      socket.emit("watchRooms", { watching: false });
      socket.off("roomsUpdate", onRooms);
    };
  }, []);

  return (
    <main className="page play-page">
      <div className="play-panel">
        <div className="play-head">
          <h1>{t("playMenu.title")}</h1>
          <span className="play-spacer" />
          <button type="button" onClick={onBack}>
            {t("common.back")}
          </button>
        </div>

        {error && <p className="play-error">{error}</p>}

        <section className="play-card">
          <h2>{t("playMenu.publicRooms", rooms.length)}</h2>
          <div className="room-list">
            {rooms.length === 0 ? (
              <p className="play-empty">{t("playMenu.noRooms")}</p>
            ) : (
              rooms.map((room) => (
                <div key={room.code} className="room-row">
                  <div className="room-row-main">
                    <div className="room-row-host">{room.hostName}</div>
                    <div className="room-row-sub">
                      <span className="room-code">{room.code}</span> ·{" "}
                      {t("playMenu.playerCount", room.players, room.maxPlayers)}
                      {room.picks.some((pick) => pick.length > 0) &&
                        ` · ${room.picks
                          .filter((pick) => pick.length > 0)
                          .map((pick) => pick.join("/"))
                          .join(" vs ")}`}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="primary"
                    disabled={busy}
                    onClick={() => onJoin(room.code)}
                  >
                    {t("playMenu.join")}
                  </button>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="play-card">
          <h2>{t("playMenu.joinWithCode")}</h2>
          <div className="play-row">
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder={t("playMenu.codePlaceholder")}
              maxLength={4}
            />
            <button type="button" disabled={busy || !code.trim()} onClick={() => onJoin(code)}>
              {t("playMenu.join")}
            </button>
          </div>
        </section>

        <section className="play-card">
          <h2>{t("playMenu.createRoom")}</h2>
          <div className="play-row">
            <span className="visibility-toggle">
              <button
                type="button"
                className={visibility === "public" ? "on" : ""}
                onClick={() => setVisibility("public")}
              >
                Public
              </button>
              <button
                type="button"
                className={visibility === "private" ? "on" : ""}
                onClick={() => setVisibility("private")}
              >
                Private
              </button>
            </span>
            <span className="play-spacer" />
            <button
              type="button"
              className="primary"
              disabled={busy}
              onClick={() => onCreate(visibility)}
            >
              {t("playMenu.createRoom")}
            </button>
          </div>
          <p className="play-empty" style={{ textAlign: "left", padding: 0 }}>
            {visibility === "public" ? t("playMenu.publicDesc") : t("playMenu.privateDesc")}
          </p>
        </section>
      </div>
    </main>
  );
}
