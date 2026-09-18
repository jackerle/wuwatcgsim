import { useSyncExternalStore } from "react";
import { preloadProgress, subscribePreload } from "./imagePreload";

/**
 * Read-only view of the background card-art warm-up — {done:0,total:0}
 * before anything has kicked it off. Doesn't start the warm-up itself
 * (warmCardImages() does that, once, from the app root) so a component that
 * only wants to show progress can't accidentally trigger it a second time.
 */
export function useCardPreloadProgress(): { done: number; total: number } {
  return useSyncExternalStore(subscribePreload, preloadProgress, preloadProgress);
}
