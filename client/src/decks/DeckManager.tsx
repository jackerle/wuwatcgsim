// The saved decks, and the way in and out of the builder.
//
// Doubles as the deck picker: the lobby shows the same list with `onPick`
// set, so "which deck am I bringing" and "which deck am I editing" are one
// screen rather than two that could drift apart.

import { useState } from "react";
import { deckIssues, deckSize, isDeckPlayable, isStarterDeckId, type DeckList } from "@wuwatcg/shared";
import { CardArt } from "../board/CardImage";
import { ImagePreloadPill } from "../board/ImagePreloadPill";
import { allDecks, createDeck, deleteDeck, saveDeck, type SavedDeck } from "./storage";
import { coverOf, COVER_SIZE } from "./cover";
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
              const copy: SavedDeck = {
                ...createDeck(`${deck.name} ${t("deckManager.copySuffix")}`),
                characters: [...deck.characters],
                cards: { ...deck.cards },
                cover: (deck as SavedDeck).cover ? [...(deck as SavedDeck).cover!] : undefined,
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
  deck: SavedDeck;
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
  const cover = coverOf(deck);

  return (
    <div
      className={`deck-row ${onPick && playable ? "selectable" : ""} ${chosen ? "chosen" : ""}`}
      onClick={onPick && playable ? () => onPick(deck) : undefined}
      role={onPick && playable ? "button" : undefined}
    >
      <span
        className={`deck-row-status ${playable ? "ok" : "bad"}`}
        title={playable ? t("deckManager.playable") : `${t("deckManager.incomplete")} — ${why}`}
        aria-label={playable ? t("deckManager.playable") : t("deckManager.incomplete")}
      >
        {playable ? <IconCheck /> : <IconAlert />}
      </span>

      {/* The cover: three cards, chosen in the builder or each character at
          their highest level — see coverOf. */}
      <div className="deck-cover">
        {Array.from({ length: COVER_SIZE }, (_, i) => cover[i]).map((card, i) => (
          <span className="deck-cover-card" key={card?.id ?? `empty-${i}`} title={card?.name}>
            {card ? (
              <CardArt card={{ cardId: card.id, imageId: card.imageId, name: card.name, kind: "character" }} />
            ) : (
              <span className="deck-cover-empty" />
            )}
          </span>
        ))}
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
        </div>
        <div className="deck-row-sub">
          {t("deckManager.cardCount", deckSize(deck))}
          {why && <span className="deck-row-why"> — {why}</span>}
        </div>
      </div>

      <div className="deck-row-actions" onClick={(e) => e.stopPropagation()}>
        {onEdit && (
          <button type="button" className="deck-icon-button" onClick={onEdit} title={t("deckManager.edit")} aria-label={t("deckManager.edit")}>
            <IconPencil />
          </button>
        )}
        <button
          type="button"
          className="deck-icon-button"
          onClick={onDuplicate}
          title={t("deckManager.duplicate")}
          aria-label={t("deckManager.duplicate")}
        >
          <IconCopy />
        </button>
        {onDelete && (
          <button
            type="button"
            className="deck-icon-button danger"
            onClick={onDelete}
            title={t("deckManager.delete")}
            aria-label={t("deckManager.delete")}
          >
            <IconTrash />
          </button>
        )}
      </div>
    </div>
  );
}

// Line icons for the row. Inline rather than an icon font or files: four of
// them, and currentColor lets the buttons colour them.
const ICON = {
  width: 24,
  height: 24,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

function IconCheck() {
  return (
    <svg {...ICON}>
      <circle cx="12" cy="12" r="9.5" />
      <path d="M7.5 12.5l3 3 6-6.5" />
    </svg>
  );
}

function IconAlert() {
  return (
    <svg {...ICON}>
      <circle cx="12" cy="12" r="9.5" />
      <path d="M12 7v6M12 16.5v.5" />
    </svg>
  );
}

function IconPencil() {
  return (
    <svg {...ICON}>
      <path d="M4 20l1-4.5L15.5 5a2.1 2.1 0 013 3L8 18.5 4 20z" />
      <path d="M13.5 7l3 3" />
    </svg>
  );
}

function IconCopy() {
  return (
    <svg {...ICON}>
      <rect x="8" y="8" width="12" height="13" rx="2" />
      <path d="M16 8V5a2 2 0 00-2-2H6a2 2 0 00-2 2v11a2 2 0 002 2h2" />
      <path d="M11 12.5h6M11 16h6" />
    </svg>
  );
}

function IconTrash() {
  return (
    <svg {...ICON}>
      <path d="M4 7h16M9.5 7V4.5h5V7" />
      <path d="M6 7l1 13h10l1-13" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  );
}
