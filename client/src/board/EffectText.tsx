import { effectSegments, type CardEffect, type Lang } from "@wuwatcg/shared";

/**
 * A card's printed ability, with its keyword tags drawn as tags.
 *
 * The colours are the ones wuwatcgdb prints — orange for when an effect
 * fires, purple for when it applies at all, blue for the follow-up chain —
 * so a player who learned the keywords there reads the same three groups
 * here. Which run of text is a keyword is decided in shared/src/cardDef.ts,
 * because it takes the effect's conditions to know; this only paints.
 */
export function EffectText({ effect, lang = "th" }: { effect: CardEffect; lang?: Lang }) {
  return (
    <>
      {effectSegments(effect, lang).map((segment, index) =>
        segment.color ? (
          <span key={index} className="kw-tag" style={{ background: segment.color }}>
            {segment.text}
          </span>
        ) : (
          <span key={index}>{segment.text}</span>
        )
      )}
    </>
  );
}
