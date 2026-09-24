import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { ActionCard } from "@wuwatcg/shared";
import { CardImage } from "./CardImage";
import { CardMenu, useDismiss, type CardMenuItem } from "./CardMenu";

const COLOR_LABEL: Record<ActionCard["color"], string> = {
  red: "R",
  green: "G",
  blue: "B",
};

export function Hand({
  cards,
  faceDown,
  selected,
  selectionMeans = "pick",
  onCardClick,
  menuFor,
  unplayable,
  dealKey,
}: {
  cards: ActionCard[];
  faceDown?: boolean;
  /**
   * What being selected means here. Picking a card out to charge or pay with
   * lifts it; picking one out for the mulligan is giving it up, so it sinks
   * instead — the two must not look the same, since one keeps the card and
   * the other throws it back.
   */
  selectionMeans?: "pick" | "return";
  /**
   * Why each card cannot be played right now, by hand position. Cost, an
   * Action Area cap, or a card that only an ability can put into play — the
   * engine works it out, this only shows it.
   */
  unplayable?: (card: ActionCard, index: number) => string | null;
  /**
   * Positions currently picked out, NOT card ids. A deck holds several copies
   * of the same printed card, so selecting by id lights up every copy in hand
   * at once.
   */
  selected?: number[];
  /** Given the card and its position — a hand can legitimately hold copies. */
  onCardClick?: (card: ActionCard, index: number) => void;
  /**
   * What this card can be told to do — charge it, lay it face-down, combo
   * with it. Returning something turns the click into a menu; returning
   * nothing leaves the click to onCardClick, which is what picks cards out
   * while a Level Up is being paid for.
   */
  menuFor?: (card: ActionCard, index: number) => CardMenuItem[] | undefined;
  /**
   * Something that only changes when this is a brand new match (the match
   * id works well). A freshly dealt hand isn't a "draw" — it's the starting
   * hand — so this is what tells the animation below not to play on arrival.
   */
  dealKey?: string | number;
}) {
  // Every path that adds cards to a hand appends to the end of the array
  // (see draw/return/search in shared/src/effects.ts and match.ts), so
  // "new since last render" is just "index >= the length hand had before".
  // Comparing lengths this way means no per-card diffing is needed, and it
  // costs nothing on renders where the hand didn't grow.
  const drawnFromRef = useRef(cards.length);
  const dealKeyRef = useRef(dealKey);
  if (dealKeyRef.current !== dealKey) {
    // A new match: reset the baseline to the freshly dealt hand so it does
    // not play the "just drawn" animation on arrival.
    dealKeyRef.current = dealKey;
    drawnFromRef.current = cards.length;
  }
  const drawnFrom = drawnFromRef.current;

  // Which hand POSITION has its menu open, for the same reason `selected`
  // holds positions: the same printed card can sit in a hand twice.
  const [openAt, setOpenAt] = useState<number | null>(null);
  const menuRef = useDismiss(openAt !== null, () => setOpenAt(null));

  useEffect(() => {
    drawnFromRef.current = cards.length;
  }, [cards.length]);

  // A hand that just changed is a hand whose menu is about to be wrong: the
  // card it was opened on may not even be there any more.
  useEffect(() => {
    setOpenAt(null);
  }, [cards.length, faceDown]);

  return (
    // The count goes to CSS so a full hand shrinks its cards to stay on one
    // row instead of wrapping — see .hand-card in Board.css.
    <div
      className={`hand ${faceDown ? "face-down" : ""}`}
      style={{ "--hand-count": Math.max(cards.length, 1) } as CSSProperties}
    >
      {cards.map((card, index) => {
        // Staggered slightly so drawing several cards at once reads as a
        // dealt sequence rather than everything popping in at once.
        const justDrawn = index >= drawnFrom;
        const style = justDrawn ? { animationDelay: `${(index - drawnFrom) * 70}ms` } : undefined;

        if (faceDown) {
          // A deck holds copies of the same printed card, so the id alone is
          // not unique within a hand — the position has to be part of the key.
          return (
            <div
              key={`${card.id}-${index}`}
              className={`hand-card card-back ${justDrawn ? "just-drawn" : ""}`}
              style={style}
            />
          );
        }

        const items = menuFor?.(card, index);
        const open = openAt === index && items && items.length > 0;
        const click = items?.length
          ? () => setOpenAt((current) => (current === index ? null : index))
          : onCardClick
            ? () => onCardClick(card, index)
            : undefined;

        return (
          <div
            key={`${card.id}-${index}`}
            className="hand-card-wrap"
            ref={open ? menuRef : undefined}
          >
            <div
              className={`hand-card ${
                selected?.includes(index) ? (selectionMeans === "return" ? "returning" : "selected") : ""
              } ${
                click ? "clickable" : ""
              } ${unplayable?.(card, index) ? "unplayable" : ""} ${
                justDrawn ? "just-drawn" : ""
              } ${open ? "menu-open" : ""}`}
              style={style}
              title={unplayable?.(card, index) ?? undefined}
              onClick={click}
              role={click ? "button" : undefined}
            >
              <CardImage
                card={{
                  cardId: card.id,
                  imageId: card.imageId,
                  name: card.name,
                  kind: "action",
                  cost: card.cost,
                  color: card.color,
                  damage: card.damage,
                  speed: card.speed,
                }}
              />
              <span className={`stat-pill cost color-${card.color}`}>{card.cost}</span>
              <span className="stat-pill color-badge">{COLOR_LABEL[card.color]}</span>
              <span className="stat-row">
                <span title="Damage">{card.damage}</span>
                <span title="Speed">{card.speed}</span>
              </span>
            </div>

            {open && (
              <CardMenu
                head={card.name}
                items={items!.map((item) => ({
                  ...item,
                  onPick: () => {
                    setOpenAt(null);
                    item.onPick();
                  },
                }))}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
