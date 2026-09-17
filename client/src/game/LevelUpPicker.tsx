// The Level Up dropdown, built by hand instead of a native <select>.
//
// A native <option> gives the browser no hook to hover — nothing fires while
// the list is open, so the big Preview panel and the Detail panel (which
// every other card in the app is looked up through) have no way to follow
// it. Hover is wired on each ROW here rather than through CardImage's own
// built-in wiring: the thumbnail is small next to the label text, and
// CardImage only fires while the pointer is over the image itself, so
// hovering the label would have gone dark. CardArt (the plain, hover-free
// half of CardImage) still does the actual rendering, fallback chain
// included.
//
// The menu is portalled to <body> rather than rendered inline: the trigger
// sits inside .control-actions, which scrolls sideways to fit however many
// moves are on offer. Setting only overflow-x there makes the browser treat
// overflow-y as auto too (CSS's rule for a lone axis), so a plain absolutely
// positioned child clips to that thin bar instead of floating below it.
// Portalling escapes that ancestor entirely; position is tracked by hand
// against the trigger's own bounding box instead.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { CharacterCard } from "@wuwatcg/shared";
import { CardArt } from "../board/CardImage";
import { useHoverPreview } from "../board/HoverPreviewContext";

export function LevelUpPicker({
  options,
  value,
  onChange,
}: {
  options: CharacterCard[];
  value: string;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const chosen = options.find((card) => card.id === value) ?? options[0] ?? null;
  const { setHovered } = useHoverPreview();

  // Placed against the trigger's own screen position, since the portal puts
  // it outside any layout that would otherwise anchor it.
  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    setMenuPos({ top: rect.bottom + 4, left: rect.left });
  }, [open]);

  // Closing on an outside click or Escape is the one bit a native <select>
  // gives for free — everything else about it is what we're replacing.
  // Scrolling closes it too, rather than trying to keep a portalled menu
  // glued to a trigger that just moved out from under it.
  useEffect(() => {
    if (!open) return;
    const onDocClick = (event: MouseEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    // capture: true reaches scrolls on any scrollable ancestor, not only
    // window — scroll events don't bubble, but the capture phase still runs.
    // The menu's own option list scrolls this way too (it's a long list in
    // a fixed-height box), and that must NOT close it — only a scroll
    // outside the menu, which would detach it from a trigger that just
    // moved, should.
    const onScroll = (event: Event) => {
      if (menuRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    document.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  return (
    <div className="level-picker">
      <button
        ref={triggerRef}
        type="button"
        className="control-select level-picker-trigger"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="level-picker-trigger-label">
          {chosen ? `${chosen.name} Lv.${chosen.level} (${chosen.id}) — ทิ้ง ${chosen.level}` : "เลือกตัวละคร"}
        </span>
        <span className="level-picker-caret" aria-hidden="true">
          ▾
        </span>
      </button>

      {open &&
        menuPos &&
        createPortal(
          <div
            className="level-picker-menu"
            ref={menuRef}
            style={{ top: menuPos.top, left: menuPos.left }}
          >
            {options.map((card) => (
              <button
                key={card.id}
                type="button"
                className={`level-picker-option ${card.id === value ? "picked" : ""}`}
                onMouseEnter={() =>
                  setHovered({
                    cardId: card.id,
                    imageId: card.imageId,
                    name: card.name,
                    kind: "character",
                    level: card.level,
                  })
                }
                onMouseLeave={() => setHovered(null)}
                onClick={() => {
                  onChange(card.id);
                  setOpen(false);
                }}
              >
                <span className="level-picker-thumb">
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
                <span className="level-picker-label">
                  {card.name} Lv.{card.level}
                  <small>
                    ({card.id}) — ทิ้ง {card.level}
                  </small>
                </span>
              </button>
            ))}
          </div>,
          document.body
        )}
    </div>
  );
}
