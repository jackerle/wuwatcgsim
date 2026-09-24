import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import type { ActionCard, CharacterInstance } from "@wuwatcg/shared";
import { CardArt } from "./CardImage";
import type { HoverPreviewCard } from "./HoverPreviewContext";

/**
 * Drag a card to where it goes, instead of opening its menu: a card from hand
 * onto the Concerto area charges it, onto your Action Area lays it down (or
 * combos with it); a character onto another slot switches the Leader.
 *
 * Only a shortcut. Every drop sends the very move the card's menu would, and
 * which drops are on offer is asked of PlayGame (`targetsFor`), which asks the
 * engine — so a drag can never do something the menu would not. Menus and
 * clicks still work exactly as before; a press that never moves far enough is
 * one of those.
 *
 * Pointer events, not the HTML drag-and-drop API: that one does nothing on a
 * touch screen, and phones are half of why this exists.
 */

export type DragPayload =
  | { kind: "hand"; card: ActionCard; index: number }
  | { kind: "character"; slot: CharacterInstance };

/** A drop target's id → what dropping there does. */
export type DropTargets = Record<string, () => void>;

/** Past this many pixels a press becomes a drag. */
const DRAG_START_PX = 8;

interface DragView {
  /** The ids that would take the card being dragged; empty when not dragging. */
  targets: ReadonlySet<string>;
  /** The target under the pointer right now. */
  over: string | null;
  /** Starts watching a press on a draggable card. */
  press: (event: ReactPointerEvent, payload: DragPayload, preview: HoverPreviewCard) => void;
}

const DragContext = createContext<DragView | null>(null);

export function DragProvider({
  targetsFor,
  children,
}: {
  targetsFor: (payload: DragPayload) => DropTargets;
  children: ReactNode;
}) {
  const [active, setActive] = useState<{
    preview: HoverPreviewCard;
    targets: DropTargets;
    x: number;
    y: number;
  } | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const ghost = useRef<HTMLDivElement>(null);
  // The latest rules, read when a drag starts rather than captured when the
  // press began — a press can outlive a render.
  const targetsForRef = useRef(targetsFor);
  useEffect(() => {
    targetsForRef.current = targetsFor;
  });
  const cleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => cleanup.current?.(), []);

  const press = useCallback(
    (event: ReactPointerEvent, payload: DragPayload, preview: HoverPreviewCard) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      cleanup.current?.();
      const start = { x: event.clientX, y: event.clientY };
      const pointerId = event.pointerId;
      let targets: DropTargets | null = null;
      let currentOver: string | null = null;

      const targetAt = (x: number, y: number): string | null => {
        const found = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-drop]");
        const id = found?.dataset.drop ?? null;
        return id && targets && id in targets ? id : null;
      };

      const onMove = (move: PointerEvent) => {
        if (move.pointerId !== pointerId) return;
        if (!targets) {
          if (Math.hypot(move.clientX - start.x, move.clientY - start.y) < DRAG_START_PX) return;
          const offered = targetsForRef.current(payload);
          // Nowhere to put it: not a drag at all. Let the press be whatever
          // else it was — a click, a hold, a scroll.
          if (Object.keys(offered).length === 0) return finish();
          targets = offered;
          setActive({ preview, targets: offered, x: move.clientX, y: move.clientY });
        }
        move.preventDefault();
        if (ghost.current) {
          ghost.current.style.transform = `translate(${move.clientX}px, ${move.clientY}px) translate(-50%, -60%) rotate(-4deg)`;
        }
        const next = targetAt(move.clientX, move.clientY);
        if (next !== currentOver) {
          currentOver = next;
          setOver(next);
        }
      };

      const onUp = (up: PointerEvent) => {
        if (up.pointerId !== pointerId) return;
        if (targets) {
          // The release ends in a click on whatever is under it. After a drag
          // that click means nothing — it must not open a menu or pick a card.
          const swallow = (click: MouseEvent) => {
            click.stopPropagation();
            click.preventDefault();
          };
          window.addEventListener("click", swallow, { capture: true, once: true });
          window.setTimeout(() => window.removeEventListener("click", swallow, true), 400);
          const dropped = targetAt(up.clientX, up.clientY);
          if (dropped) targets[dropped]();
        }
        finish();
      };

      function finish() {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", finish);
        cleanup.current = null;
        setActive(null);
        setOver(null);
      }

      window.addEventListener("pointermove", onMove, { passive: false });
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", finish);
      cleanup.current = finish;
    },
    []
  );

  const view = useMemo<DragView>(
    () => ({ targets: new Set(active ? Object.keys(active.targets) : []), over, press }),
    [active, over, press]
  );

  return (
    <DragContext.Provider value={view}>
      {children}
      {active && (
        <div
          ref={ghost}
          className="drag-ghost"
          style={{
            transform: `translate(${active.x}px, ${active.y}px) translate(-50%, -60%) rotate(-4deg)`,
          }}
          aria-hidden="true"
        >
          <CardArt card={active.preview} />
        </div>
      )}
    </DragContext.Provider>
  );
}

export function useDrag(): DragView {
  const view = useContext(DragContext);
  if (!view) throw new Error("useDrag must be used within a DragProvider");
  return view;
}

/**
 * What a drop target needs: the attribute that makes it one, and the class
 * that lights it up while a card that can go there is being dragged. `id`
 * undefined means this element is not a target (the far side's board).
 */
export function useDropTarget(id: string | undefined): {
  dropProps: { "data-drop"?: string };
  dropClass: string;
} {
  const { targets, over } = useDrag();
  if (!id) return { dropProps: {}, dropClass: "" };
  const live = targets.has(id);
  return {
    dropProps: { "data-drop": id },
    dropClass: live ? (over === id ? "drop-target drop-over" : "drop-target") : "",
  };
}
