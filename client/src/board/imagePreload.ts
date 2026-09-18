// Warms the browser's own cache for card art, once per session.
//
// CardArt already renders fine without this — every <img> just requests its
// URL on demand. The cost shows up in deck building and match previews:
// each newly-hovered card is one the browser has never fetched, so the very
// first look at it stalls on a network round trip. Once a URL has been
// loaded here, later requests for the exact same URL come straight out of
// the browser's cache — a second component asking for it, a re-hover, a
// different screen showing the same card — none of that costs a request
// again. This module doesn't replace that cache; it just gets one shot at
// filling it early, quietly, in the background, instead of one card at a
// time under the player's cursor.

import { ALL_CARDS, allImageIds } from "@wuwatcg/shared";

/** Every image file CardArt could ever ask the server for. */
export function allCardImageUrls(): string[] {
  const ids = new Set<string>();
  for (const card of ALL_CARDS) {
    for (const id of allImageIds(card)) ids.add(id);
  }
  return [...ids].map((id) => `/cards/${id}.jpg`);
}

type Listener = () => void;

let started = false;
const listeners = new Set<Listener>();
/** The actual de-dupe: a URL already requested this session is never asked for again. */
const requested = new Set<string>();

// useSyncExternalStore compares snapshots with Object.is, so the getter has
// to hand back the SAME object while nothing has changed — a fresh
// {done,total} literal on every call would read as a change on every render
// and loop.
let snapshot = { done: 0, total: 0 };

function notify(): void {
  for (const listener of listeners) listener();
}

function setDone(done: number): void {
  snapshot = { ...snapshot, done };
  notify();
}

function loadOne(url: string): Promise<void> {
  if (requested.has(url)) return Promise.resolve();
  requested.add(url);
  return new Promise<void>((resolve) => {
    const img = new Image();
    // A missing file still has to "settle", or one bad path would leave the
    // progress counter short forever and the pill stuck at less than 100%.
    img.onload = () => resolve();
    img.onerror = () => resolve();
    img.src = url;
  }).then(() => {
    setDone(snapshot.done + 1);
  });
}

/**
 * Starts warming the whole card library. Safe to call from anywhere and as
 * many times as you like — only the first call does anything; the rest just
 * find it already running (or already finished).
 */
export function warmCardImages(): void {
  if (started) return;
  started = true;
  const urls = allCardImageUrls();
  snapshot = { done: 0, total: urls.length };
  notify();
  void Promise.allSettled(urls.map(loadOne));
}

export function preloadProgress(): { done: number; total: number } {
  return snapshot;
}

export function subscribePreload(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
