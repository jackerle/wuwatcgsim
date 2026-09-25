// The front door: play, or build a deck.

import { useLang } from "../i18n/LanguageContext";
import { LanguageSwitch } from "./LanguageSwitch";
import { MusicToggle } from "../audio/MusicToggle";
import "./MainMenu.css";

export function MainMenu({
  playerName,
  onNameChange,
  onPlay,
  onDecks,
  onVsBot,
  deckCount,
}: {
  playerName: string;
  onNameChange: (name: string) => void;
  onPlay: () => void;
  onDecks: () => void;
  onVsBot: () => void;
  deckCount: number;
}) {
  const { t } = useLang();

  return (
    <main className="page menu-page">
      <div className="menu-corner">
        <MusicToggle />
        <LanguageSwitch />
      </div>
      <div className="menu">
        <h1 className="menu-title">WuWa TCG</h1>
        <p className="menu-sub">{t("mainMenu.subtitle")}</p>

        <label className="menu-name">
          {t("mainMenu.playerNameLabel")}
          <input
            value={playerName}
            onChange={(e) => onNameChange(e.target.value)}
            placeholder={t("mainMenu.playerNamePlaceholder")}
            maxLength={20}
          />
        </label>

        <button
          type="button"
          className="menu-button primary"
          onClick={onPlay}
          disabled={!playerName.trim()}
          title={playerName.trim() ? undefined : t("mainMenu.needNameTitle")}
        >
          <span className="menu-button-text">
            <span className="menu-button-label">Play</span>
            <span className="menu-button-sub">{t("mainMenu.playSub")}</span>
          </span>
          <img className="menu-button-art" src="/assets/rover_f.webp" alt="" aria-hidden="true" />
        </button>

        <button type="button" className="menu-button" onClick={onDecks}>
          <span className="menu-button-text">
            <span className="menu-button-label">Deck</span>
            <span className="menu-button-sub">
              {deckCount > 0 ? t("mainMenu.deckSubWithCount", deckCount) : t("mainMenu.deckSubEmpty")}
            </span>
          </span>
          <img className="menu-button-art" src="/assets/rover_m.webp" alt="" aria-hidden="true" />
        </button>

        <button type="button" className="menu-button" onClick={onVsBot}>
          <span className="menu-button-text">
            <span className="menu-button-label">Bot</span>
            <span className="menu-button-sub">{t("mainMenu.vsBot")}</span>
          </span>
          <img
            className="menu-button-art chibi"
            src="/assets/shore_icon.jpg"
            alt=""
            aria-hidden="true"
          />
        </button>
      </div>

      <p className="menu-credit">
        <a
          className="menu-discord"
          href="https://discord.gg/hmasBuhzyk"
          target="_blank"
          rel="noopener noreferrer"
        >
          <svg viewBox="0 0 24 24" width="36" height="36" fill="currentColor" aria-hidden="true">
            <path d="M20.317 4.37a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.74 19.74 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.1 13.1 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.3 12.3 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.84 19.84 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
          </svg>
          <span className="menu-discord-text">{t("mainMenu.discordJoin")}</span>
        </a>
        <span>{t("mainMenu.credit")} jackerle</span>
      </p>
    </main>
  );
}
