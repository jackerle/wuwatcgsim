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
}) {
  return (
    <div className={`hand ${faceDown ? "face-down" : ""}`}>
      {cards.map((card, index) =>
        faceDown ? (
          // A deck holds copies of the same printed card, so the id alone is
          // not unique within a hand — the position has to be part of the key.
          <div key={`${card.id}-${index}`} className="hand-card card-back" />
        ) : (
          <div
            key={`${card.id}-${index}`}
            className={`hand-card ${selected?.includes(index) ? "selected" : ""} ${
              onCardClick ? "clickable" : ""
            } ${unplayable?.(card, index) ? "unplayable" : ""}`}
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
        )
      )}
    </div>
  );
}
