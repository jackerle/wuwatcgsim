import { getCard, subtypeLabel } from "@wuwatcg/shared";
import { EffectText } from "./EffectText";
import { useHoverPreview, type HoverPreviewCard } from "./HoverPreviewContext";
import { useLang, type StringKey } from "../i18n/LanguageContext";

const COLOR_KEY: Record<string, StringKey> = {
  red: "detailPanel.colorRed",
  green: "detailPanel.colorGreen",
  blue: "detailPanel.colorBlue",
};

/**
 * Shows the stats and printed ability of whatever card is hovered. The
 * ability text comes straight from the card database, keyword tags and all
 * — and, like the rest of that data, is Thai-only for almost every card
 * (see strings.ts's header comment), so it stays Thai even in English mode.
 */
export function DetailPanel() {
  const { t } = useLang();
  const { hovered } = useHoverPreview();

  if (!hovered) {
    return (
      <div className="side-panel detail-panel">
        <div className="side-panel-header">Detail</div>
        <div className="side-panel-body placeholder">{t("detailPanel.placeholder")}</div>
      </div>
    );
  }

  return (
    <div className="side-panel detail-panel">
      <div className="side-panel-header">Detail</div>
      <div className="side-panel-body">
        <CardDetail card={hovered} />
      </div>
    </div>
  );
}

/**
 * A card's name, stats and printed ability — the Detail panel's content, and
 * also what the touch-screen CardPeek shows under the enlarged card.
 */
export function CardDetail({ card }: { card: HoverPreviewCard }) {
  const { t, lang } = useLang();
  const definition = card.cardId ? getCard(card.cardId) : undefined;

  // The printed categories — Normal Attack, Heavy Attack, Resonance Skill.
  // Other cards refer to these by name in their text, so knowing which ones a
  // card carries is the difference between an ability applying and not.
  const subtypes = definition?.type === "action" ? (definition.subtypes ?? []) : [];

  return (
    <>
      <h3 className="detail-name">{card.name}</h3>

      {definition && (
        <p className="detail-meta">
          {definition.id}
          {definition.character && ` · ${definition.character}`}
          {definition.type === "leader" && ` · Lv.${definition.level}`}
        </p>
      )}

      {subtypes.length > 0 && (
        <ul className="detail-tags">
          {subtypes.map((subtype) => (
            <li key={subtype} className="detail-tag">
              {subtypeLabel(subtype)}
            </li>
          ))}
        </ul>
      )}

      {card.kind === "character" ? (
        <dl className="detail-stats">
          <dt>Level</dt>
          <dd>{card.level}</dd>
        </dl>
      ) : (
        <dl className="detail-stats">
          <dt>Cost</dt>
          <dd>{card.cost}</dd>
          <dt>Color</dt>
          <dd className={`color-${card.color}`}>
            {card.color ? t(COLOR_KEY[card.color]) : "-"}
          </dd>
          <dt>Damage</dt>
          <dd>{card.damage}</dd>
          <dt>Speed</dt>
          {/* Blue cards print no Speed — blue always draws against blue. */}
          <dd>{definition?.type === "action" && definition.speed === null ? "-" : card.speed}</dd>
        </dl>
      )}
      {definition && definition.effects.length > 0 ? (
        <ul className="detail-effects">
          {definition.effects.map((effect, index) => (
            <li key={index} className={effect.resolve ? "" : "manual"}>
              <EffectText effect={effect} lang={lang} />
              {!effect.resolve && <span className="manual-tag">{t("detailPanel.manualTag")}</span>}
            </li>
          ))}
        </ul>
      ) : (
        <p className="detail-note">{t("detailPanel.noEffect")}</p>
      )}
    </>
  );
}
