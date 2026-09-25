// Playing the bot: pick what you are bringing, pick what it is bringing, go.
//
// No server, no second person, no room — the whole match runs in this tab off
// the same engine everything else uses. See useBotMatch for what the bot is
// and is not allowed to see.

import { useState } from "react";
import { isDeckPlayable, type DeckList } from "@wuwatcg/shared";
import { PlayGame } from "./PlayGame";
import { useBotMatch } from "./useBotMatch";
import { DeckManager } from "../decks/DeckManager";
import {
  allDecks,
  rememberBotDeckId,
  rememberDeckId,
  rememberedBotDeckId,
  rememberedDeckId,
} from "../decks/storage";
import { useLang } from "../i18n/LanguageContext";
import "../menu/MainMenu.css";

/** The hook cannot be called conditionally, so the match gets its own shell. */
function BotMatch({
  deck,
  botDeck,
  onLeave,
}: {
  deck: DeckList;
  botDeck: DeckList;
  onLeave: () => void;
}) {
  const match = useBotMatch({ deck, botDeck });
  // A rematch is the deck picks again — the same place leaving goes.
  return <PlayGame match={match} onLeave={onLeave} onRematch={onLeave} />;
}

const randomDeck = (decks: DeckList[]): DeckList | null =>
  decks.length > 0 ? decks[Math.floor(Math.random() * decks.length)] : null;

export function BotGame({ onBack }: { onBack: () => void }) {
  const { t } = useLang();
  // allDecks, not the stored ones: the built-in decks are playable like any
  // other, and for someone who has never opened the builder they are the only
  // ones there are.
  const playable = allDecks().filter(isDeckPlayable);
  const [deck, setDeck] = useState<DeckList | null>(
    () => playable.find((entry) => entry.id === rememberedDeckId()) ?? playable[0] ?? null
  );
  // The bot picks from the very same list the player does. Preselect its last
  // deck, then a random one so the opening screen is not blank.
  const [botDeck, setBotDeck] = useState<DeckList | null>(
    () => playable.find((entry) => entry.id === rememberedBotDeckId()) ?? randomDeck(playable)
  );
  // Which picker is open, if any — the player's own or the bot's.
  const [picking, setPicking] = useState<"self" | "bot" | null>(null);
  const [playing, setPlaying] = useState(false);

  if (playing && deck && botDeck) {
    return (
      <main className="page board-page">
        {/* Leaving goes back to the deck picks, the way leaving an online
            room goes back to the room list — so a rematch, or the same
            matchup with a different deck, is one click away. */}
        <BotMatch deck={deck} botDeck={botDeck} onLeave={() => setPlaying(false)} />
      </main>
    );
  }

  if (picking === "self") {
    return (
      <DeckManager
        title={t("lobby.pickDeckTitle")}
        pickedId={deck?.id ?? rememberedDeckId()}
        onPick={(chosen) => {
          setDeck(chosen);
          rememberDeckId(chosen.id);
          setPicking(null);
        }}
        onBack={() => setPicking(null)}
      />
    );
  }

  if (picking === "bot") {
    return (
      <DeckManager
        title={t("bot.pickBotDeckTitle")}
        pickedId={botDeck?.id ?? rememberedBotDeckId()}
        onPick={(chosen) => {
          setBotDeck(chosen);
          rememberBotDeckId(chosen.id);
          setPicking(null);
        }}
        onBack={() => setPicking(null)}
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
              <button type="button" onClick={() => setPicking("self")}>
                {t("lobby.change")}
              </button>
            </div>
          ) : (
            <div className="play-row">
              <button type="button" className="primary" onClick={() => setPicking("self")}>
                {playable.length > 0 ? t("lobby.chooseDeck") : t("lobby.buildDeckFirst")}
              </button>
            </div>
          )}
        </section>

        <section className="play-card">
          <h2>{t("bot.opponent")}</h2>
          {botDeck ? (
            <div className="room-row">
              <div className="room-row-main">
                <div className="room-row-host">{botDeck.name}</div>
                <div className="room-row-sub">{botDeck.characters.join(" · ")}</div>
              </div>
              <div className="deck-row-actions">
                <button type="button" onClick={() => setBotDeck(randomDeck(playable))}>
                  {t("bot.randomDeck")}
                </button>
                <button type="button" onClick={() => setPicking("bot")}>
                  {t("lobby.change")}
                </button>
              </div>
            </div>
          ) : (
            <div className="play-row">
              <button type="button" className="primary" onClick={() => setPicking("bot")}>
                {playable.length > 0 ? t("bot.chooseBotDeck") : t("lobby.buildDeckFirst")}
              </button>
            </div>
          )}
          <p className="play-empty" style={{ textAlign: "left", padding: 0 }}>
            {t("bot.fairPlay")}
          </p>
        </section>

        <div className="play-row">
          <span className="play-spacer" />
          <button
            type="button"
            className="primary"
            disabled={!deck || !botDeck}
            onClick={() => setPlaying(true)}
          >
            {t("bot.start")}
          </button>
        </div>
      </div>
    </main>
  );
}
