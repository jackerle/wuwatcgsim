// Finding a game: the public rooms waiting for someone, a box for a private
// code, and a button to open a room of your own.
//
// The list is pushed by the server while this screen is open (watchRooms) and
// stops the moment it closes, so a match in progress never pays for someone
// else's browsing.

import { useEffect, useState } from "react";
import type { RoomSummary, RoomVisibility } from "@wuwatcg/shared";
import { socket } from "../socket";
import "./MainMenu.css";

export function PlayMenu({
  onJoin,
  onCreate,
  onBack,
  error,
}: {
  onJoin: (code: string) => void;
  onCreate: (visibility: RoomVisibility) => void;
  onBack: () => void;
  error: string | null;
}) {
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
          <h1>เล่นออนไลน์</h1>
          <span className="play-spacer" />
          <button type="button" onClick={onBack}>
            กลับ
          </button>
        </div>

        {error && <p className="play-error">{error}</p>}

        <section className="play-card">
          <h2>ห้องสาธารณะ ({rooms.length})</h2>
          <div className="room-list">
            {rooms.length === 0 ? (
              <p className="play-empty">ยังไม่มีใครเปิดห้องรออยู่ — สร้างห้องเองได้เลย</p>
            ) : (
              rooms.map((room) => (
                <div key={room.code} className="room-row">
                  <div className="room-row-main">
                    <div className="room-row-host">{room.hostName}</div>
                    <div className="room-row-sub">
                      <span className="room-code">{room.code}</span> · {room.players}/{room.maxPlayers} คน
                      {room.picks.some((pick) => pick.length > 0) &&
                        ` · ${room.picks
                          .filter((pick) => pick.length > 0)
                          .map((pick) => pick.join("/"))
                          .join(" vs ")}`}
                    </div>
                  </div>
                  <button type="button" className="primary" onClick={() => onJoin(room.code)}>
                    เข้าร่วม
                  </button>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="play-card">
          <h2>เข้าห้องด้วยรหัส</h2>
          <div className="play-row">
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="เช่น AB12"
              maxLength={4}
            />
            <button type="button" disabled={!code.trim()} onClick={() => onJoin(code)}>
              เข้าร่วม
            </button>
          </div>
        </section>

        <section className="play-card">
          <h2>สร้างห้อง</h2>
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
            <button type="button" className="primary" onClick={() => onCreate(visibility)}>
              สร้างห้อง
            </button>
          </div>
          <p className="play-empty" style={{ textAlign: "left", padding: 0 }}>
            {visibility === "public"
              ? "ใครก็เข้ามาเล่นด้วยได้ ห้องจะขึ้นในลิสต์ด้านบน"
              : "ห้องจะไม่ขึ้นในลิสต์ ต้องบอกรหัสห้องให้เพื่อนเอง"}
          </p>
        </section>
      </div>
    </main>
  );
}
