import { useState } from "react";
import type { ActionCard, MatchState, RevealEntry } from "@wuwatcg/shared";
import { CardImage } from "./CardImage";
import { useLang } from "../i18n/LanguageContext";
import type { StringKey } from "../i18n/strings";

const artOf = (card: ActionCard) => ({
  cardId: card.id,
  imageId: card.imageId,
  name: card.name,
  kind: "action" as const,
});

const KIND_LABEL: Record<RevealEntry["kind"], StringKey> = {
  revealTop: "reveal.revealTop",
  toHand: "reveal.toHand",
  trashToHand: "reveal.trashToHand",
  search: "reveal.search",
  hand: "reveal.hand",
};

/** Stable for as long as the engine keeps the entry, so a dismissal sticks. */
const keyOf = (state: MatchState, entry: RevealEntry, index: number) =>
  `${state.matchId}:${state.turnNumber}:${entry.phase}:${index}:${entry.sourceCardId}`;

/**
 * Cards an ability has turned face-up for both players — the top of a deck,
 * a card taken to hand, a whole hand — held on the board for the rest of the
 * phase (the engine drops them when the phase moves on; see RevealEntry).
 * Not modal: the game carries on underneath, and each one can be closed.
 */
export function RevealPanel({
  state,
  nameOf,
  hidden,
}: {
  state: MatchState;
  nameOf: (seat: string) => string;
  /** Held back while a cut-in covers the board; dismissals are kept. */
  hidden?: boolean;
}) {
  const { t } = useLang();
  const [closed, setClosed] = useState<string[]>([]);

  const open = (state.reveals ?? [])
    .map((entry, index) => ({ entry, key: keyOf(state, entry, index) }))
    .filter(({ entry, key }) => entry.phase && !closed.includes(key));
  if (hidden || open.length === 0) return null;

  return (
    <div className="reveal-panel" aria-live="polite">
      {open.map(({ entry, key }) => (
        <section key={key} className="reveal-entry">
          <header className="reveal-head">
            <span className="reveal-title">
              {t(KIND_LABEL[entry.kind], nameOf(entry.playerId), entry.cards.length)}
            </span>
            {entry.taken !== undefined && (
              <span className="reveal-taken">{t("reveal.taken", entry.taken)}</span>
            )}
            <button
              type="button"
              className="reveal-close"
              aria-label={t("common.close")}
              title={t("common.close")}
              onClick={() => setClosed((c) => [...c, key])}
            >
              ×
            </button>
          </header>
          <div className="reveal-cards">
            {entry.cards.map((card, i) => (
              <div
                key={`${card.id}-${i}`}
                className={`reveal-card ${entry.taken !== undefined && i >= entry.taken ? "left" : ""}`}
              >
                <CardImage card={artOf(card)} />
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

/** The same cards inside a question, for the player deciding about them. */
export function RevealedInChoice({ entries }: { entries: RevealEntry[] }) {
  const { t } = useLang();
  const cards = entries.flatMap((entry) => entry.cards);
  if (cards.length === 0) return null;
  return (
    <div className="choice-revealed">
      <span className="choice-revealed-label">{t("reveal.inChoice")}</span>
      <div className="choice-revealed-cards">
        {cards.map((card, i) => (
          <div key={`${card.id}-${i}`} className="reveal-card">
            <CardImage card={artOf(card)} />
          </div>
        ))}
      </div>
    </div>
  );
}
