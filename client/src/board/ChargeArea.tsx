import type { ActionCard } from "@wuwatcg/shared";
import { CardImage } from "./CardImage";

/** The Concerto (Competition) Area — charged cards, placed sideways, spent to pay costs. */
export function ChargeArea({ cards }: { cards: ActionCard[] }) {
  return (
    <div className="charge-area">
      <span className="charge-area-label">協奏</span>
      <div className="charge-area-stack">
        {cards.length === 0 ? (
          <span className="charge-area-empty" />
        ) : (
          // Keyed by POSITION as well as id: the Concerto area is a pile of
          // charged cards and the same printed card lands in it over and
          // over, so the id alone is not unique. React quietly drops the
          // duplicates, which is how the stack came to show fewer cards than
          // the count beside it.
          cards.map((card, index) => (
            <div key={`${card.id}-${index}`} className="charge-card">
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
            </div>
          ))
        )}
      </div>
      <span className="charge-area-count">{cards.length}</span>
    </div>
  );
}
