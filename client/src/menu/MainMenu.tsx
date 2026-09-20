// The front door: play, or build a deck.

import { useLang } from "../i18n/LanguageContext";
import { LanguageSwitch } from "./LanguageSwitch";
import "./MainMenu.css";

export function MainMenu({
  playerName,
  onNameChange,
  onPlay,
  onDecks,
  onHotseat,
  onVsBot,
  deckCount,
}: {
  playerName: string;
  onNameChange: (name: string) => void;
  onPlay: () => void;
  onDecks: () => void;
  onHotseat: () => void;
  onVsBot: () => void;
  deckCount: number;
}) {
  const { t } = useLang();

  return (
    <main className="page menu-page">
      <LanguageSwitch />
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
          <img className="menu-button-art" src="/cards/rover_f.webp" alt="" aria-hidden="true" />
        </button>

        <button type="button" className="menu-button" onClick={onDecks}>
          <span className="menu-button-text">
            <span className="menu-button-label">Deck</span>
            <span className="menu-button-sub">
              {deckCount > 0 ? t("mainMenu.deckSubWithCount", deckCount) : t("mainMenu.deckSubEmpty")}
            </span>
          </span>
          <img className="menu-button-art" src="/cards/rover_m.webp" alt="" aria-hidden="true" />
        </button>

        <button type="button" className="menu-button" onClick={onVsBot}>
          <span className="menu-button-text">
            <span className="menu-button-label">Bot</span>
            <span className="menu-button-sub">{t("mainMenu.vsBot")}</span>
          </span>
          <img
            className="menu-button-art chibi"
            src="/cards/shore_icon.jpg"
            alt=""
            aria-hidden="true"
          />
        </button>

        <button type="button" className="menu-link" onClick={onHotseat}>
          {t("mainMenu.hotseat")}
        </button>
      </div>

      <p className="menu-credit">
        {t("mainMenu.credit")} <a href="mailto:zeustololisis@gmail.com">zeustololisis@gmail.com</a>
      </p>
    </main>
  );
}
