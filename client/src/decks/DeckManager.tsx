// The saved decks, and the way in and out of the builder.
//
// Doubles as the deck picker: the lobby shows the same list with `onPick`
// set, so "which deck am I bringing" and "which deck am I editing" are one
// screen rather than two that could drift apart.

import { useState } from "react";
import { deckIssues, deckSize, isDeckPlayable, type DeckList } from "@wuwatcg/shared";
import { CardArt } from "../board/CardImage";
import { ImagePreloadPill } from "../board/ImagePreloadPill";
import { createDeck, deleteDeck, loadDecks, saveDeck } from "./storage";
import { portraitOf } from "./portraits";
import { DeckBuilder } from "./DeckBuilder";
import "./DeckBuilder.css";

export function DeckManager({
  onBack,
  onPick,
  pickedId,
  title = "เด็คของฉัน",
}: {
  onBack: () => void;
  /** Set when this list is being used to choose a deck for a match. */
  onPick?: (deck: DeckList) => void;
  pickedId?: string | null;
  title?: string;
}) {
  const [decks, setDecks] = useState<DeckList[]>(loadDecks);
  const [editing, setEditing] = useState<DeckList | null>(null);

  if (editing) {
    return (
      <DeckBuilder
        deck={editing}
        onCancel={() => setEditing(null)}
        onSave={(deck) => {
          setDecks(saveDeck(deck));
          setEditing(null);
        }}
      />
    );
  }

  return (
    <main className="page deck-page">
      <div className="deck-list">
        <div className="deck-list-head">
          <h1>{title}</h1>
          <ImagePreloadPill />
          <span className="deck-bar-spacer" />
          <div className="deck-row-actions">
            <button type="button" onClick={() => setEditing(createDeck())}>
              + สร้างเด็คใหม่
            </button>
            <button type="button" onClick={onBack}>
              กลับ
            </button>
          </div>
        </div>

        {decks.length === 0 && (
          <p className="deck-empty">
            ยังไม่มีเด็ค — กด "สร้างเด็คใหม่" เพื่อเลือกตัวละคร 3 ตัวและจัดการ์ด
          </p>
        )}

        {decks.map((deck) => (
          <DeckRow
            key={deck.id}
            deck={deck}
            chosen={pickedId === deck.id}
            onPick={onPick}
            onEdit={() => setEditing(deck)}
            onDelete={() => setDecks(deleteDeck(deck.id))}
            onDuplicate={() => {
              const copy = { ...createDeck(`${deck.name} (สำเนา)`), characters: [...deck.characters], cards: { ...deck.cards } };
              setDecks(saveDeck(copy));
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
  onEdit: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
}) {
  const playable = isDeckPlayable(deck);
  // An unfinished deck can still be saved and come back to — it just says so,
  // and the picker refuses it rather than letting a match fail to deal.
  const why = playable ? "" : deckIssues(deck)[0];

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
        <div className="deck-row-name">{deck.name}</div>
        <div className="deck-row-sub">
          {deck.characters.length > 0 ? deck.characters.join(" · ") : "ยังไม่ได้เลือกตัวละคร"}
          {" — "}
          {deckSize(deck)} ใบ
          {why && ` — ${why}`}
        </div>
      </div>

      <span className={`deck-row-badge ${playable ? "ok" : ""}`}>
        {playable ? "พร้อมเล่น" : "ยังไม่ครบ"}
      </span>

      <div className="deck-row-actions" onClick={(e) => e.stopPropagation()}>
        <button type="button" onClick={onEdit}>
          แก้ไข
        </button>
        <button type="button" onClick={onDuplicate}>
          ทำสำเนา
        </button>
        <button type="button" className="danger" onClick={onDelete}>
          ลบ
        </button>
      </div>
    </div>
  );
}
