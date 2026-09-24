// The card sound: drawing, a card coming into hand, laying one down, and the
// two committed cards turning over at the reveal.
//
// Several short copies of one sound can overlap (two cards drawn at once, a
// reveal right after a play), so each play takes the next element from a
// small pool instead of restarting a single one mid-sound. Silenced by the
// same toggle as the music.

import { isMusicMuted } from "./bgm";

const SRC = "/assets/card_sfx.mp3";
/** A touch above the music (bgm.ts), so a card is heard over it. */
const VOLUME = 0.35;
const POOL_SIZE = 4;

let pool: HTMLAudioElement[] = [];
let next = 0;

export function playCardSfx() {
  if (isMusicMuted() || document.hidden) return;
  if (pool.length === 0) {
    pool = Array.from({ length: POOL_SIZE }, () => {
      const el = new Audio(SRC);
      el.preload = "auto";
      el.volume = VOLUME;
      return el;
    });
  }
  const el = pool[next];
  next = (next + 1) % pool.length;
  el.currentTime = 0;
  // Refused before the first interaction; a missed sound is not worth a retry.
  el.play().catch(() => {});
}
