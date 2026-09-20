// Playing the bot: pick what you are bringing, pick what it is bringing, go.
//
// No server, no second person, no room — the whole match runs in this tab off
// the same engine everything else uses. See useBotMatch for what the bot is
// and is not allowed to see.

import { useState } from "react";
import {
  isDeckPlayable,
  playableCharacters,
  starterDeck,
  type DeckList,
} from "@wuwatcg/shared";
import { PlayGame } from "./PlayGame";
import { useBotMatch } from "./useBotMatch";
import { DeckManager } from "../decks/DeckManager";
import { allDecks, rememberDeckId, rememberedDeckId } from "../decks/storage";
import { useLang } from "../i18n/LanguageContext";
import "../menu/MainMenu.css";

/** The hook cannot be called conditionally, so the match gets its own shell. */
function BotMatch({ deck, botDeck }: { deck: DeckList; botDeck: DeckList }) {
  const match = useBotMatch({ deck, botDeck });
  return <PlayGame match={match} />;
}

const randomCharacter = (): string => {
  const names = playableCharacters();
  return names[Math.floor(Math.random() * names.length)];
};

export function BotGame({ onBack }: { onBack: () => void }) {
  const { t } = useLang();
  // allDecks, not the stored ones: the built-in decks are playable like any
  // other, and for someone who has never opened the builder they are the only
  // ones there are.
  const playable = allDecks().filter(isDeckPlayable);
  const [deck, setDeck] = useState<DeckList | null>(
    () => playable.find((entry) => entry.id === rememberedDeckId()) ?? playable[0] ?? null
  );
  const [botCharacter, setBotCharacter] = useState(randomCharacter);
  const [picking, setPicking] = useState(false);
  const [playing, setPlaying] = useState(false);

  if (playing && deck) {
    return (
      <main className="page board-page">
        <BotMatch deck={deck} botDeck={starterDeck(botCharacter)} />
      </main>
    );
  }

  if (picking) {
    return (
      <DeckManager
        title={t("lobby.pickDeckTitle")}
        pickedId={deck?.id ?? rememberedDeckId()}
        onPick={(chosen) => {
          setDeck(chosen);
          rememberDeckId(chosen.id);
          setPicking(false);
        }}
        onBack={() => setPicking(false)}
      />
    );
  }

  return (
    <main className="page play-page">
      <div className="play-panel">
        <div className="play-head">
          <h1>{t("bot.title")}</h1>
          <span className="play-spacer" />
          <button type="button" onClick={onBack}>
            {t("common.back")}
          </button>
        </div>

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
            </div>
          )}
        </section>

        <section className="play-card">
          <h2>{t("bot.opponent")}</h2>
          <div className="room-row">
            <div className="room-row-main">
              <div className="room-row-host">{t("bot.name")}</div>
              <div className="room-row-sub">{botCharacter}</div>
            </div>
            <button type="button" onClick={() => setBotCharacter(randomCharacter())}>
              {t("bot.reroll")}
            </button>
          </div>
          <p className="play-empty" style={{ textAlign: "left", padding: 0 }}>
            {t("bot.fairPlay")}
          </p>
        </section>

        <div className="play-row">
          <span className="play-spacer" />
          <button
            type="button"
            className="primary"
            disabled={!deck}
            onClick={() => setPlaying(true)}
          >
            {t("bot.start")}
          </button>
        </div>
      </div>
    </main>
  );
}
