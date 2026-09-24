import { useEffect, useRef, type HTMLAttributes, type PointerEvent } from "react";

/** How long a finger has to stay on a card before it opens. */
const LONG_PRESS_MS = 450;
/** How far it may drift and still count as holding rather than scrolling. */
const LONG_PRESS_SLOP_PX = 10;

/**
 * Press and hold — a finger, a pen, or the left mouse button. On a touch
 * screen it is the only way to read a card; with a mouse, hover already fills
 * the side panels, but in a portrait window those sit below the board, so a
 * held click is quicker than scrolling. A press that drifts is a scroll (or a
 * mouse on its way somewhere else), not a hold.
 *
 * Once the hold fires, the tap that ends it must not ALSO land as a click:
 * that would open the card's menu (or play it) underneath the preview. So the
 * next click anywhere is swallowed before it reaches anything.
 */
export function useLongPress(onLongPress: () => void): HTMLAttributes<HTMLElement> {
  const timer = useRef<number | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);

  const cancel = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    start.current = null;
  };

  useEffect(() => cancel, []);

  return {
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      // Left button only for a mouse: a right-click is the browser's menu.
      if (event.pointerType === "mouse" && event.button !== 0) return;
      cancel();
      fired.current = false;
      start.current = { x: event.clientX, y: event.clientY };
      timer.current = window.setTimeout(() => {
        timer.current = null;
        fired.current = true;
        const swallow = (click: MouseEvent) => {
          click.stopPropagation();
          click.preventDefault();
        };
        window.addEventListener("click", swallow, { capture: true, once: true });
        // A hold that ends without any click (the finger slid off) must not
        // leave the listener waiting to eat some later, unrelated tap.
        window.setTimeout(() => window.removeEventListener("click", swallow, true), 1000);
        onLongPress();
      }, LONG_PRESS_MS);
    },
    onPointerMove: (event: PointerEvent<HTMLElement>) => {
      const from = start.current;
      if (!from) return;
      if (Math.hypot(event.clientX - from.x, event.clientY - from.y) > LONG_PRESS_SLOP_PX) cancel();
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    // A mouse is not captured the way a finger is: held down and dragged off
    // the card, it has let go of it.
    onPointerLeave: cancel,
    // The browser's own long-press menu (save image, share...) would open on
    // top of ours.
    onContextMenu: (event) => {
      if (fired.current || timer.current !== null) event.preventDefault();
    },
  };
}
