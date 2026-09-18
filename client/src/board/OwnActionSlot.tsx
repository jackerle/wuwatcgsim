import type { ActionCard } from "@wuwatcg/shared";
import { CardImage } from "./CardImage";
import { useLang } from "../i18n/LanguageContext";

/**
 * This player's Action Area.
 *
 * It holds one thing at a time: the face-down card committed for the Counter
 * Phase, or — once both cards are turned up — the revealed card plus every
 * follow-up comboed on top of it.
 */
export function OwnActionSlot({
  facedown,
  revealed,
  hideFacedown,
}: {
  /** Committed but not yet turned up. */
  facedown: ActionCard | null;
  /** Turned up, oldest first: the clash card then its follow-ups. */
  revealed: ActionCard[];
  /** True for the opponent's side — a committed card shows only its back. */
  hideFacedown?: boolean;
}) {
  const { t } = useLang();
  const cards = revealed.length > 0 ? revealed : [];

  return (
    <div className="own-action-slot">
      <div className="action-slot-cards">
        {cards.length > 0 ? (
          cards.map((card, index) => (
            <div key={`${card.id}-${index}`} className="action-slot-card">
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
            </div>
          ))
        ) : facedown ? (
          hideFacedown ? (
            <div className="action-slot-card card-back" />
          ) : (
            <div className="action-slot-card committed">
              <CardImage
                card={{
                  cardId: facedown.id,
                  imageId: facedown.imageId,
                  name: facedown.name,
                  kind: "action",
                  cost: facedown.cost,
                  color: facedown.color,
                  damage: facedown.damage,
                  speed: facedown.speed,
                }}
              />
              <span className="action-slot-committed">{t("ownActionSlot.committed")}</span>
            </div>
          )
        ) : (
          <div className="action-slot-card empty" />
        )}
      </div>
      <span className="action-slot-label">Action Area</span>
    </div>
  );
}
