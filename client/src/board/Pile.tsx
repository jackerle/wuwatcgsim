import { CardImage } from "./CardImage";
import type { HoverPreviewCard } from "./HoverPreviewContext";
import { usePileModal } from "./PileModalContext";

/** A face-down draw pile, or a face-up pile (trash / open character pool). */
export function Pile({
  label,
  count,
  topCard,
  cards,
}: {
  label: string;
  count: number;
  /** If given, the pile is shown face-up using this card (trash / character pool). */
  topCard?: HoverPreviewCard | null;
  /**
   * Full contents, in order — when given, the pile is clickable and opens
   * a big scrollable grid showing every card (Pool / Trash can hold up to
   * 40). Omit for piles that shouldn't be browsable (e.g. the face-down
   * Deck).
   */
  cards?: HoverPreviewCard[];
}) {
  const { setOpenPile } = usePileModal();
  const clickable = cards !== undefined;
  // No top card means nothing is showing: it is a face-down pile, so the
  // layers that stand in for its bulk get the printed card back rather than
  // the neutral texture a face-up pile uses under its top card.
  const faceDown = !topCard;

  return (
    <div
      className={`pile ${clickable ? "pile-clickable" : ""} ${faceDown ? "pile-facedown" : ""}`}
      onClick={clickable ? () => setOpenPile({ label, cards: cards! }) : undefined}
      role={clickable ? "button" : undefined}
    >
      <div className={`pile-stack ${count === 0 ? "empty" : ""}`}>
        {count > 0 && <div className="pile-layer pile-layer-2" />}
        {count > 0 && <div className="pile-layer pile-layer-1" />}
        <div className="pile-layer pile-top">{topCard ? <CardImage card={topCard} /> : null}</div>
      </div>
      <span className="pile-label">
        {label} {count}
      </span>
    </div>
  );
}
