import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import { CardArt } from "./CardImage";
import { useLongPress } from "./useLongPress";
import { useHoverPreview, type HoverPreviewCard } from "./HoverPreviewContext";

/** One thing a card on the board can be told to do. */
export interface CardMenuItem {
  key: string;
  label: ReactNode;
  /** The small print under the label — what the move costs, or means. */
  hint?: ReactNode;
  /**
   * Shown as a thumbnail, and pushed to the Preview/Detail panels while the
   * row is hovered. For a menu whose entries ARE cards — which card to level
   * up with, which character to switch to.
   */
  card?: HoverPreviewCard;
  onPick: () => void;
}

/**
 * Closes a menu on an outside click or Escape.
 *
 * A card on a board has nowhere to put a close button, so this is the whole
 * way out of every menu here. Returns the ref that marks what counts as
 * "inside".
 */
export function useDismiss(open: boolean, onDismiss: () => void): RefObject<HTMLDivElement | null> {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    // A card held open full-size (CardPeek) sits on top of the menu it was
    // opened from — a Level Up choice, say. Closing it is not leaving the
    // menu: the point of looking was to come back and pick.
    const peekOpen = () => document.querySelector(".card-peek-backdrop") !== null;
    const onDown = (event: MouseEvent) => {
      if (peekOpen()) return;
      if (!ref.current?.contains(event.target as Node)) onDismiss();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !peekOpen()) onDismiss();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onDismiss]);
  return ref;
}

/**
 * The little menu a card opens: what you can do with THIS card, asked at the
 * card itself.
 *
 * Every move here used to be a button in the control bar, which has one row
 * to fit a whole turn into and no way to say which card a button meant. What
 * belongs on the menu is never decided here — the caller asks the engine and
 * passes the answer in.
 *
 * Opens upward: the only cards that get a menu are the ones on the near side
 * of the table, at the bottom of the screen.
 */
export function CardMenu({ head, items }: { head?: ReactNode; items: CardMenuItem[] }) {
  return (
    <div className="card-menu">
      {head && <span className="card-menu-head">{head}</span>}
      {items.map((item) => (
        <CardMenuRow key={item.key} item={item} />
      ))}
    </div>
  );
}

/**
 * One entry. An entry that IS a card — which card to level up with, which
 * character to switch to — also opens that card full-size on press and hold
 * (CardPeek), so it can be read before it is picked; hover alone never
 * reaches it on a touch screen.
 */
function CardMenuRow({ item }: { item: CardMenuItem }) {
  const { setHovered, setPeeked } = useHoverPreview();
  const pressHandlers = useLongPress(() => {
    if (!item.card) return;
    setHovered(item.card);
    setPeeked(item.card);
  });

  return (
    <button
      type="button"
      data-card-id={item.card?.cardId}
      onMouseEnter={item.card ? () => setHovered(item.card!) : undefined}
      onMouseLeave={item.card ? () => setHovered(null) : undefined}
      onClick={() => {
        if (item.card) setHovered(null);
        item.onPick();
      }}
      {...(item.card ? pressHandlers : undefined)}
    >
      {item.card && (
        <span className="card-menu-thumb">
          <CardArt card={item.card} />
        </span>
      )}
      <span className="card-menu-label">
        {item.label}
        {item.hint && <small>{item.hint}</small>}
      </span>
    </button>
  );
}
