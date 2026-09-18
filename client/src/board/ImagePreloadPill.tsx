import { useCardPreloadProgress } from "./useCardPreloadProgress";

/**
 * A quiet status pill for the one-time card-art warm-up — visible only
 * while it's actually behind, so a returning player who's already fully
 * cached never sees it at all. Deck screens are where the gap is most
 * felt (every character and pool card is a hover away), so they're the
 * ones that show it.
 */
export function ImagePreloadPill() {
  const { done, total } = useCardPreloadProgress();
  if (total === 0 || done >= total) return null;

  return (
    <span className="image-preload-pill" title="โหลดรูปการ์ดไว้ล่วงหน้า เพื่อให้ดูตัวอย่างได้ไม่มีสะดุด">
      กำลังโหลดรูปการ์ด… {done}/{total}
    </span>
  );
}
