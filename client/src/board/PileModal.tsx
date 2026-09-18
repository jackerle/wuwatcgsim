import { usePileModal } from "./PileModalContext";
import { CardImage } from "./CardImage";
import { useLang } from "../i18n/LanguageContext";

/**
 * Full pile contents (Pool / Trash — up to 40 cards) as a big scrollable
 * grid overlay. Opens on click, closes on backdrop click or the X button.
 */
export function PileModal() {
  const { t } = useLang();
  const { openPile, setOpenPile } = usePileModal();
  if (!openPile) return null;

  return (
    <div className="pile-modal-backdrop" onClick={() => setOpenPile(null)}>
      <div className="pile-modal" onClick={(e) => e.stopPropagation()}>
        <div className="pile-modal-header">
          <span>
            {openPile.label} ({openPile.cards.length})
          </span>
          <button type="button" className="pile-modal-close" onClick={() => setOpenPile(null)}>
            ✕
          </button>
        </div>
        <div className="pile-modal-grid">
          {openPile.cards.length === 0 ? (
            <p className="pile-modal-empty">{t("pileModal.empty")}</p>
          ) : (
            openPile.cards.map((card, i) => (
              <div key={`${card.imageId}-${i}`} className="pile-modal-card">
                <CardImage card={card} />
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
