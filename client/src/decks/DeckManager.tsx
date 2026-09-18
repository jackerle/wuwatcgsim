// The saved decks, and the way in and out of the builder.
//
// Doubles as the deck picker: the lobby shows the same list with `onPick`
// set, so "which deck am I bringing" and "which deck am I editing" are one
// screen rather than two that could drift apart.

import { useState } from "react";
import { deckIssues, deckSize, isDeckPlayable, isStarterDeckId, type DeckList } from "@wuwatcg/shared";
import { CardArt } from "../board/CardImage";
import { ImagePreloadPill } from "../board/ImagePreloadPill";
import { allDecks, createDeck, deleteDeck, saveDeck } from "./storage";
import { portraitOf } from "./portraits";
import { DeckBuilder } from "./DeckBuilder";
import { useLang } from "../i18n/LanguageContext";
import "./DeckBuilder.css";

export function DeckManager({
  onBack,
  onPick,
  pickedId,
  title,
}: {
  onBack: () => void;
  /** Set when this list is being used to choose a deck for a match. */
  onPick?: (deck: DeckList) => void;
  pickedId?: string | null;
  /** Defaults to "My Decks" in the current language when omitted. */
  title?: string;
}) {
  const { t } = useLang();
  // allDecks, not loadDecks: the built-in decks are not in storage, so every
  // refresh of this list has to go back through the merge. saveDeck and
  // deleteDeck hand back the STORED decks only — using their return value
  // directly is what would make the starters vanish after any edit.
  const [decks, setDecks] = useState<DeckList[]>(allDecks);
  const [editing, setEditing] = useState<DeckList | null>(null);

  if (editing) {
    return (
      <DeckBuilder
        deck={editing}
        onCancel={() => setEditing(null)}
        onSave={(deck) => {
          saveDeck(deck);
          setDecks(allDecks());
          setEditing(null);
        }}
      />
    );
  }

  return (
    <main className="page deck-page">
      <div className="deck-list">
        <div className="deck-list-head">
          <h1>{title ?? t("deckManager.title")}</h1>
          <ImagePreloadPill />
          <span className="deck-bar-spacer" />
          <div className="deck-row-actions">
            <button type="button" onClick={() => setEditing(createDeck(t("deckManager.newDeckDefaultName")))}>
              {t("deckManager.newDeck")}
            </button>
            <button type="button" onClick={onBack}>
              {t("common.back")}
            </button>
          </div>
        </div>

        {decks.length === 0 && <p className="deck-empty">{t("deckManager.empty")}</p>}

        {decks.map((deck) => (
          <DeckRow
            key={deck.id}
            deck={deck}
            chosen={pickedId === deck.id}
            onPick={onPick}
            // A built-in deck has nothing to edit or delete: it lives in code,
            // so a "delete" would appear to work and then come back on the
            // next load. Duplicate is how you get one you can change.
            onEdit={isStarterDeckId(deck.id) ? undefined : () => setEditing(deck)}
            onDelete={
              isStarterDeckId(deck.id)
                ? undefined
                : () => {
                    deleteDeck(deck.id);
                    setDecks(allDecks());
                  }
            }
            onDuplicate={() => {
              const copy = {
                ...createDeck(`${deck.name} ${t("deckManager.copySuffix")}`),
                characters: [...deck.characters],
                cards: { ...deck.cards },
              };
              saveDeck(copy);
              setDecks(allDecks());
            }}
          />
        ))}
      </div>
    </main>
  );
}

function DeckRow({
  deck,
  chosen,
  onPick,
  onEdit,
  onDelete,
  onDuplicate,
}: {
  deck: DeckList;
  chosen: boolean;
  onPick?: (deck: DeckList) => void;
  /** Left out for a built-in deck, which cannot be changed in place. */
  onEdit?: () => void;
  /** Left out for a built-in deck, which cannot be removed. */
  onDelete?: () => void;
  onDuplicate: () => void;
}) {
  const { t, lang } = useLang();
  const playable = isDeckPlayable(deck);
  // An unfinished deck can still be saved and come back to — it just says so,
  // and the picker refuses it rather than letting a match fail to deal.
  const why = playable ? "" : deckIssues(deck, lang)[0];

  return (
    <div
      className={`deck-row ${onPick && playable ? "selectable" : ""} ${chosen ? "chosen" : ""}`}
      onClick={onPick && playable ? () => onPick(deck) : undefined}
      role={onPick && playable ? "button" : undefined}
    >
      <div className="deck-row-portraits">
        {Array.from({ length: 3 }, (_, i) => deck.characters[i]).map((name, i) => {
          const art = name ? portraitOf(name) : null;
          return (
            <span className="deck-row-portrait" key={i} title={name}>
              {art ? (
                <CardArt card={{ cardId: art.id, imageId: art.imageId, name: name!, kind: "character" }} />
              ) : (
                <span className="deck-row-portrait-empty" />
              )}
            </span>
          );
        })}
      </div>

      <div className="deck-row-main">
        <div className="deck-row-name">
          {deck.name}
          {isStarterDeckId(deck.id) && (
            <span className="deck-row-tag" title={t("deckManager.starterTitle")}>
              {t("deckManager.starter")}
            </span>
          )}
        </div>
        <div className="deck-row-sub">
          {deck.characters.length > 0 ? deck.characters.join(" · ") : t("deckManager.noCharacters")}
          {" — "}
          {t("deckManager.cardCount", deckSize(deck))}
          {why && ` — ${why}`}
        </div>
      </div>

      <span className={`deck-row-badge ${playable ? "ok" : ""}`}>
        {playable ? t("deckManager.playable") : t("deckManager.incomplete")}
      </span>

      <div className="deck-row-actions" onClick={(e) => e.stopPropagation()}>
        {onEdit && (
          <button type="button" onClick={onEdit}>
            {t("deckManager.edit")}
          </button>
        )}
        <button type="button" onClick={onDuplicate}>
          {t("deckManager.duplicate")}
        </button>
        {onDelete && (
          <button type="button" className="danger" onClick={onDelete}>
            {t("deckManager.delete")}
          </button>
        )}
      </div>
    </div>
  );
}
