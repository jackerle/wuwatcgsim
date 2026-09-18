// The front door: play, or build a deck.

import "./MainMenu.css";

export function MainMenu({
  playerName,
  onNameChange,
  onPlay,
  onDecks,
  onHotseat,
  deckCount,
}: {
  playerName: string;
  onNameChange: (name: string) => void;
  onPlay: () => void;
  onDecks: () => void;
  onHotseat: () => void;
  deckCount: number;
}) {
  return (
    <main className="page menu-page">
      <div className="menu">
        <h1 className="menu-title">WuWa TCG</h1>
        <p className="menu-sub">Wuthering Waves TCG Simulator</p>

        <label className="menu-name">
          ชื่อผู้เล่น
          <input
            value={playerName}
            onChange={(e) => onNameChange(e.target.value)}
            placeholder="ใส่ชื่อของคุณ"
            maxLength={20}
          />
        </label>

        <button
          type="button"
          className="menu-button primary"
          onClick={onPlay}
          disabled={!playerName.trim()}
          title={playerName.trim() ? undefined : "ใส่ชื่อก่อน"}
        >
          <span className="menu-button-text">
            <span className="menu-button-label">Play</span>
            <span className="menu-button-sub">หาห้อง หรือสร้างห้องใหม่</span>
          </span>
          <img className="menu-button-art" src="/cards/rover_f.webp" alt="" aria-hidden="true" />
        </button>

        <button type="button" className="menu-button" onClick={onDecks}>
          <span className="menu-button-text">
            <span className="menu-button-label">Deck</span>
            <span className="menu-button-sub">
              {deckCount > 0 ? `จัดเด็ค — มีอยู่ ${deckCount} เด็ค` : "จัดเด็ค — ยังไม่มีเด็ค"}
            </span>
          </span>
          <img className="menu-button-art" src="/cards/rover_m.webp" alt="" aria-hidden="true" />
        </button>

        <button type="button" className="menu-link" onClick={onHotseat}>
          เล่นสองฝั่งบนจอนี้ (ไม่ต้องมีคู่)
        </button>
      </div>
    </main>
  );
}
