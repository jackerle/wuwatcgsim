import { useCardPreloadProgress } from "./useCardPreloadProgress";
import { useLang } from "../i18n/LanguageContext";

/**
 * A quiet status pill for the one-time card-art warm-up — visible only
 * while it's actually behind, so a returning player who's already fully
 * cached never sees it at all. Deck screens are where the gap is most
 * felt (every character and pool card is a hover away), so they're the
 * ones that show it.
 */
export function ImagePreloadPill() {
  const { t } = useLang();
  const { done, total } = useCardPreloadProgress();
  if (total === 0 || done >= total) return null;

  return (
    <span className="image-preload-pill" title={t("imagePreload.title")}>
      {t("imagePreload.loading", done, total)}
    </span>
  );
}
