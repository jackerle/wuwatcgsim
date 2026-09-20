import type { ActionCard } from "@wuwatcg/shared";
import { CardImage } from "./CardImage";
import type { HoverPreviewCard } from "./HoverPreviewContext";
import { usePileModal } from "./PileModalContext";
import { useLang } from "../i18n/LanguageContext";

function previewOf(card: ActionCard): HoverPreviewCard {
  return {
    cardId: card.id,
    imageId: card.imageId,
    name: card.name,
    kind: "action",
    cost: card.cost,
    color: card.color,
    damage: card.damage,
    speed: card.speed,
  };
}

/**
 * The Concerto / Energy Area.
 *
 * Energy is public and spent oldest-first, but it can grow far beyond the
 * board's vertical budget. The table therefore shows one compact sideways
 * top card plus the authoritative count; clicking opens the same pile modal
 * Pool and Trash use, with every card in the exact stored/spend order.
 */
export function ChargeArea({ cards }: { cards: ActionCard[] }) {
  const { t } = useLang();
  const { setOpenPile } = usePileModal();
  const previews = cards.map(previewOf);
  const top = previews[0] ?? null; // first to be spent, matching payCost()
  const open = () => setOpenPile({ label: t("chargeArea.label"), cards: previews });

  return (
    <div
      className="charge-area charge-area-clickable"
      onClick={open}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          open();
        }
      }}
      role="button"
      tabIndex={0}
      title={t("chargeArea.openTitle", cards.length)}
    >
      <span className="charge-area-label">{t("chargeArea.label")}</span>
      <div className={`charge-area-stack ${cards.length === 0 ? "empty" : ""}`}>
        {top ? (
          <>
            {cards.length > 1 && <span className="charge-card-layer charge-card-layer-back" />}
            {cards.length > 2 && <span className="charge-card-layer charge-card-layer-mid" />}
            <span className="charge-card">
              <CardImage card={top} />
            </span>
          </>
        ) : (
          <span className="charge-area-empty" />
        )}
      </div>
      <span className="charge-area-count">{cards.length}</span>
    </div>
  );
}
