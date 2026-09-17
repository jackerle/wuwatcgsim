import { useEffect, useRef } from "react";
import type { ActionCard } from "@wuwatcg/shared";
import { CardImage } from "./CardImage";

const COLOR_LABEL: Record<ActionCard["color"], string> = {
  red: "R",
  green: "G",
  blue: "B",
};

export function Hand({
  cards,
  faceDown,
  selected,
  onCardClick,
  unplayable,
  dealKey,
}: {
  cards: ActionCard[];
  faceDown?: boolean;
  /**
   * Why each card cannot be played right now, by hand position. Cost, an
   * Action Area cap, or a card that only an ability can put into play — the
   * engine works it out, this only shows it.
   */
  unplayable?: (card: ActionCard, index: number) => string | null;
  /**
   * Positions currently picked out, NOT card ids. A deck holds several copies
   * of the same printed card, so selecting by id lights up every copy in hand
   * at once.
   */
  selected?: number[];
  /** Given the card and its position — a hand can legitimately hold copies. */
  onCardClick?: (card: ActionCard, index: number) => void;
  /**
   * Something that only changes when this is a brand new match (the match
   * id works well). A freshly dealt hand isn't a "draw" — it's the starting
   * hand — so this is what tells the animation below not to play on arrival.
   */
  dealKey?: string | number;
}) {
  // Every path that adds cards to a hand appends to the end of the array
  // (see draw/return/search in shared/src/effects.ts and match.ts), so
  // "new since last render" is just "index >= the length hand had before".
  // Comparing lengths this way means no per-card diffing is needed, and it
  // costs nothing on renders where the hand didn't grow.
  const drawnFromRef = useRef(cards.length);
  const dealKeyRef = useRef(dealKey);
  if (dealKeyRef.current !== dealKey) {
    // A new match: reset the baseline to the freshly dealt hand so it does
    // not play the "just drawn" animation on arrival.
    dealKeyRef.current = dealKey;
    drawnFromRef.current = cards.length;
  }
  const drawnFrom = drawnFromRef.current;

  useEffect(() => {
    drawnFromRef.current = cards.length;
  }, [cards.length]);

  return (
    <div className={`hand ${faceDown ? "face-down" : ""}`}>
      {cards.map((card, index) => {
        // Staggered slightly so drawing several cards at once reads as a
        // dealt sequence rather than everything popping in at once.
        const justDrawn = index >= drawnFrom;
        const style = justDrawn ? { animationDelay: `${(index - drawnFrom) * 70}ms` } : undefined;

        return faceDown ? (
          // A deck holds copies of the same printed card, so the id alone is
          // not unique within a hand — the position has to be part of the key.
          <div
            key={`${card.id}-${index}`}
            className={`hand-card card-back ${justDrawn ? "just-drawn" : ""}`}
            style={style}
          />
        ) : (
          <div
            key={`${card.id}-${index}`}
            className={`hand-card ${selected?.includes(index) ? "selected" : ""} ${
              onCardClick ? "clickable" : ""
            } ${unplayable?.(card, index) ? "unplayable" : ""} ${justDrawn ? "just-drawn" : ""}`}
            style={style}
            title={unplayable?.(card, index) ?? undefined}
            onClick={onCardClick ? () => onCardClick(card, index) : undefined}
            role={onCardClick ? "button" : undefined}
          >
            <CardImage
              card={{
                cardId: card.id,
                imageId: card.imageId,
                name: card.name,
                kind: "action",
                cost: card.cost,
                color: card.color,
                damage: card.damage,
                speed: card.speed,
              }}
            />
            <span className={`stat-pill cost color-${card.color}`}>{card.cost}</span>
            <span className="stat-pill color-badge">{COLOR_LABEL[card.color]}</span>
            <span className="stat-row">
              <span title="Damage">{card.damage}</span>
              <span title="Speed">{card.speed}</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}
