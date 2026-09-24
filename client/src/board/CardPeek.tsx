import { useEffect } from "react";
import { CardArt } from "./CardImage";
import { CardDetail } from "./DetailPanel";
import { useHoverPreview } from "./HoverPreviewContext";
import { useLang } from "../i18n/LanguageContext";

/**
 * The touch screen's version of hovering a card: press and hold any card on
 * the board — finger, pen or left mouse button, see CardImage — and it opens
 * here, full-size, with its stats and ability underneath. It stays open after
 * the press lifts — ability text is too long to read with a thumb held down —
 * and any tap or click closes it.
 *
 * Fixed to the whole viewport rather than scoped to the board like the other
 * dialogs: in portrait the side panels are not shown at all, so this is the
 * one place the card can be read.
 */
export function CardPeek() {
  const { t } = useLang();
  const { peeked, setPeeked } = useHoverPreview();

  useEffect(() => {
    if (!peeked) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPeeked(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [peeked, setPeeked]);

  if (!peeked) return null;

  return (
    <div
      className="card-peek-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={peeked.name}
      onClick={() => setPeeked(null)}
    >
      <div className="card-peek-art">
        <CardArt card={peeked} />
      </div>
      <div className="card-peek-detail">
        <CardDetail card={peeked} />
      </div>
      <p className="card-peek-hint">{t("cardPeek.closeHint")}</p>
    </div>
  );
}
