// Building one deck: three characters, then cards from what they bring.
//
// The rules all live in shared/src/deckList.ts — this screen only shows what
// is legal and why not. deckIssues() is the single source of "can you play
// this", and the same function runs on the server when the deck is handed
// in, so a deck that looks legal here cannot be refused there.

import { useMemo, useState } from "react";
import {
  CHARACTERS_IN_PLAY,
  MAX_COPIES_PER_CARD,
  cardPoolFor,
  cardsFor,
  characterCardsFor,
  deckIssues,
  deckSize,
  formatDeck,
  parseDeck,
  playableCharacters,
  type ActionCardDef,
  type DeckList,
} from "@wuwatcg/shared";
import { CardArt } from "../board/CardImage";
import { HoverPreviewProvider, useHoverPreview } from "../board/HoverPreviewContext";
import { HoverPreviewPanel } from "../board/HoverPreviewPanel";
import { DetailPanel } from "../board/DetailPanel";
import "./DeckBuilder.css";

const CHARACTERS = playableCharacters();

/** The Lv.0 card, which is the one with the portrait people recognise. */
function portraitOf(character: string): { id: string; imageId: string } | null {
  const base = cardsFor(character).characters.find((card) => card.level === 0);
  return base ? { id: base.id, imageId: base.imageId } : null;
}

export function DeckBuilder({
  deck: initial,
  onSave,
  onCancel,
}: {
  deck: DeckList;
  onSave: (deck: DeckList) => void;
  onCancel: () => void;
}) {
  return (
    <HoverPreviewProvider>
      <Builder deck={initial} onSave={onSave} onCancel={onCancel} />
    </HoverPreviewProvider>
  );
}

function Builder({
  deck: initial,
  onSave,
  onCancel,
}: {
  deck: DeckList;
  onSave: (deck: DeckList) => void;
  onCancel: () => void;
}) {
  const [deck, setDeck] = useState<DeckList>(initial);
  const [transfer, setTransfer] = useState<"import" | "export" | null>(null);
  const { setHovered } = useHoverPreview();

  const pool = useMemo(() => cardPoolFor(deck.characters), [deck.characters]);
  const issues = useMemo(() => deckIssues(deck), [deck]);
  const size = deckSize(deck);

  function toggleCharacter(name: string) {
    setDeck((current) => {
      const has = current.characters.includes(name);
      if (has) {
        // Dropping a character takes their cards with them — leaving cards
        // behind that are no longer legal would just be an error the player
        // has to hunt for later.
        const kept = current.characters.filter((c) => c !== name);
        const allowed = new Set(cardPoolFor(kept).map((card) => card.id));
        const cards = Object.fromEntries(
          Object.entries(current.cards).filter(([id]) => allowed.has(id))
        );
        return { ...current, characters: kept, cards };
      }
      if (current.characters.length >= CHARACTERS_IN_PLAY) return current;
      return { ...current, characters: [...current.characters, name] };
    });
  }

  function setCopies(id: string, copies: number) {
    setDeck((current) => {
      const next = { ...current.cards };
      const clamped = Math.max(0, Math.min(MAX_COPIES_PER_CARD, copies));
      if (clamped === 0) delete next[id];
      else next[id] = clamped;
      return { ...current, cards: next };
    });
  }

  const chosenCharacterCards = characterCardsFor(deck.characters);

  return (
    <main className="page deck-page">
      <div className="deck-builder">
        <header className="deck-bar">
          <input
            className="deck-name"
            value={deck.name}
            onChange={(e) => setDeck({ ...deck, name: e.target.value })}
            placeholder="ชื่อเด็ค"
          />
          <span className={`deck-count ${issues.length === 0 ? "ok" : ""}`}>
            {size}/40
          </span>
          <span className="deck-bar-spacer" />
          <button type="button" onClick={() => setTransfer("import")}>
            Import
          </button>
          <button type="button" onClick={() => setTransfer("export")}>
            Export
          </button>
          <button type="button" onClick={onCancel}>
            ยกเลิก
          </button>
          <button type="button" className="primary" onClick={() => onSave(deck)}>
            บันทึก
          </button>
        </header>

        <div className="deck-body">
          <section className="deck-main">
            <h3 className="deck-heading">
              ตัวละคร ({deck.characters.length}/{CHARACTERS_IN_PLAY})
            </h3>
            <div className="character-picker">
              {CHARACTERS.map((name) => {
                const picked = deck.characters.includes(name);
                const full = !picked && deck.characters.length >= CHARACTERS_IN_PLAY;
                const art = portraitOf(name);
                return (
                  <button
                    key={name}
                    type="button"
                    className={`character-chip ${picked ? "picked" : ""} ${full ? "full" : ""}`}
                    disabled={full}
                    title={full ? `เลือกได้ ${CHARACTERS_IN_PLAY} ตัวเท่านั้น` : undefined}
                    onMouseEnter={() =>
                      art &&
                      setHovered({ cardId: art.id, imageId: art.imageId, name, kind: "character", level: 0 })
                    }
                    onMouseLeave={() => setHovered(null)}
                    onClick={() => toggleCharacter(name)}
                  >
                    {art && (
                      <span className="character-chip-art">
                        <CardArt card={{ cardId: art.id, imageId: art.imageId, name, kind: "character" }} />
                      </span>
                    )}
                    <span className="character-chip-name">{name}</span>
                  </button>
                );
              })}
            </div>

            {deck.characters.length > 0 && (
              <p className="deck-note">
                การ์ดตัวละคร {chosenCharacterCards.length} ใบ (ทุกเลเวลของทั้งสามตัว) ถูกใส่ให้อัตโนมัติ
              </p>
            )}

            <h3 className="deck-heading">
              การ์ดที่เลือกได้ {pool.length > 0 && <small>({pool.length} แบบ)</small>}
            </h3>
            {deck.characters.length === 0 ? (
              <p className="deck-empty">เลือกตัวละครก่อน แล้วการ์ดของพวกเขาจะขึ้นมาให้เลือก</p>
            ) : (
              <div className="card-pool">
                {pool.map((card) => (
                  <PoolCard
                    key={card.id}
                    card={card}
                    copies={deck.cards[card.id] ?? 0}
                    onChange={(copies) => setCopies(card.id, copies)}
                    onHover={setHovered}
                  />
                ))}
              </div>
            )}
          </section>

          <aside className="deck-side">
            <div className="deck-side-preview">
              <HoverPreviewPanel />
            </div>
            <div className="deck-side-detail">
              <DetailPanel />
            </div>
            <div className="deck-side-issues">
              {issues.length === 0 ? (
                <p className="deck-ok">เด็คนี้พร้อมเล่นแล้ว</p>
              ) : (
                <ul>
                  {issues.map((issue) => (
                    <li key={issue}>{issue}</li>
                  ))}
                </ul>
              )}
            </div>
          </aside>
        </div>
      </div>

      {transfer && (
        <TransferDialog
          mode={transfer}
          deck={deck}
          onClose={() => setTransfer(null)}
          onImport={(next) => {
            // The id and slot stay put: importing edits THIS deck rather
            // than quietly creating another one behind the player's back.
            // Closing is the dialog's own call — it stays open to show any
            // lines it could not read.
            setDeck({ ...next, id: deck.id });
          }}
        />
      )}
    </main>
  );
}

function PoolCard({
  card,
  copies,
  onChange,
  onHover,
}: {
  card: ActionCardDef;
  copies: number;
  onChange: (copies: number) => void;
  onHover: ReturnType<typeof useHoverPreview>["setHovered"];
}) {
  const preview = {
    cardId: card.id,
    imageId: card.imageId,
    name: card.name,
    kind: "action" as const,
    cost: card.cost,
    color: card.color,
    damage: card.attack,
    speed: card.speed ?? 0,
  };

  return (
    <div
      className={`pool-card ${copies > 0 ? "in-deck" : ""}`}
      onMouseEnter={() => onHover(preview)}
      onMouseLeave={() => onHover(null)}
    >
      {/* Clicking the art adds one — the obvious gesture — while the row of
          buttons underneath is there for taking copies back out. */}
      <button
        type="button"
        className="pool-card-art"
        onClick={() => onChange(copies + 1)}
        disabled={copies >= MAX_COPIES_PER_CARD}
        title={copies >= MAX_COPIES_PER_CARD ? `สูงสุด ${MAX_COPIES_PER_CARD} ใบ` : "เพิ่ม 1 ใบ"}
      >
        <CardArt card={preview} />
        <span className={`pool-card-cost color-${card.color}`}>{card.cost}</span>
        {copies > 0 && <span className="pool-card-copies">{copies}</span>}
      </button>
      <div className="pool-card-controls">
        <button type="button" onClick={() => onChange(copies - 1)} disabled={copies === 0}>
          −
        </button>
        <span className="pool-card-name" title={card.name}>
          {card.name}
        </span>
        <button
          type="button"
          onClick={() => onChange(copies + 1)}
          disabled={copies >= MAX_COPIES_PER_CARD}
        >
          +
        </button>
      </div>
    </div>
  );
}

/** Paste a list in, or copy one out. Same text format either way. */
function TransferDialog({
  mode,
  deck,
  onClose,
  onImport,
}: {
  mode: "import" | "export";
  deck: DeckList;
  onClose: () => void;
  onImport: (deck: DeckList) => void;
}) {
  const [text, setText] = useState(mode === "export" ? formatDeck(deck) : "");
  const [errors, setErrors] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);

  function runImport() {
    const { deck: parsed, errors: found } = parseDeck(text, deck.id, deck.name);
    setErrors(found);
    // Lines that didn't parse are reported, but whatever DID parse is still
    // worth keeping — a single typo shouldn't throw the whole list away.
    onImport(parsed);
    // Only step out of the way once there is nothing to report. Closing on
    // every import would unmount this before the errors it just set could
    // ever be read.
    if (found.length === 0) onClose();
  }

  return (
    <div className="deck-dialog-backdrop" role="dialog" aria-modal="true">
      <div className="deck-dialog">
        <h3>{mode === "export" ? "Export เด็ค" : "Import เด็ค"}</h3>
        <p className="deck-dialog-hint">
          หนึ่งบรรทัดต่อการ์ด เช่น <code>BP01-001x1</code> หรือ <code>SD01-010x3</code>
        </p>
        <textarea
          className="deck-dialog-text"
          value={text}
          readOnly={mode === "export"}
          onChange={(e) => setText(e.target.value)}
          placeholder={"BP01-001x1\nSD01-010x3"}
          spellCheck={false}
        />
        {errors.length > 0 && (
          <ul className="deck-dialog-errors">
            {errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        )}
        <div className="deck-dialog-actions">
          <button type="button" onClick={onClose}>
            ปิด
          </button>
          {mode === "export" ? (
            <button
              type="button"
              className="primary"
              onClick={() => {
                navigator.clipboard?.writeText(text).catch(() => {});
                setCopied(true);
              }}
            >
              {copied ? "คัดลอกแล้ว" : "คัดลอก"}
            </button>
          ) : (
            <button type="button" className="primary" onClick={runImport} disabled={!text.trim()}>
              นำเข้า
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
