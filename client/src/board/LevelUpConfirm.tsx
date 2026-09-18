import type { ActionCard, CharacterCard } from "@wuwatcg/shared";
import { CardArt } from "./CardImage";
import { useLang } from "../i18n/LanguageContext";

/**
 * The last look before a Level Up goes through: what is being played, and
 * what it costs out of hand.
 *
 * Worth a stop of its own because the cost is paid in cards, permanently,
 * and the click that picked the last one is the same click that would have
 * sent the move. Reuses the engine question dialog's chrome — to a player
 * these are the same kind of moment.
 */
export function LevelUpConfirm({
  card,
  discarding,
  onConfirm,
  onCancel,
}: {
  card: CharacterCard;
  discarding: ActionCard[];
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useLang();
  return (
    <div className="choice-backdrop" role="dialog" aria-modal="true">
      <div className="choice-dialog">
        <p className="choice-prompt">
          {t("levelUpConfirm.prompt", card.name, card.level, discarding.length)}
        </p>

        <div className="levelup-confirm">
          <span className="levelup-confirm-target">
            <CardArt
              card={{
                cardId: card.id,
                imageId: card.imageId,
                name: card.name,
                kind: "character",
                level: card.level,
              }}
            />
          </span>
          <span className="levelup-confirm-arrow" aria-hidden="true">
            ←
          </span>
          <span className="levelup-confirm-cost">
            {discarding.map((discard, index) => (
              <span key={`${discard.id}-${index}`} className="levelup-confirm-card">
                <CardArt
                  card={{
                    cardId: discard.id,
                    imageId: discard.imageId,
                    name: discard.name,
                    kind: "action",
                  }}
                />
              </span>
            ))}
          </span>
        </div>

        <div className="choice-actions">
          <button type="button" className="choice-no" onClick={onCancel}>
            {t("common.cancel")}
          </button>
          <button type="button" className="choice-yes" onClick={onConfirm}>
            {t("common.confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}
