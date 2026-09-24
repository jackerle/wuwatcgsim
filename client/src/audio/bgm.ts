// The background music: one looping track under every screen.
//
// A single Audio element for the whole app, created once and never torn
// down, so moving between the menu, a lobby and a match does not restart the
// song. Not a component: nothing about it belongs to any one screen, and a
// component re-mounting (StrictMode, a route change) must not start a second
// copy on top of the first.
//
// Browsers refuse to play sound before the person has interacted with the
// page, so the first tap, click or key anywhere is what actually starts it.

import { useSyncExternalStore } from "react";

const SRC = "/assets/bg.mp3";
/** Background, not foreground: low enough to sit well under a conversation. */
const VOLUME = 0.06;
const FADE_MS = 500;
const MUTED_KEY = "wuwatcg.musicMuted";

function readMuted(): boolean {
  try {
    return localStorage.getItem(MUTED_KEY) === "1";
  } catch {
    return false;
  }
}

let muted = readMuted();
let audio: HTMLAudioElement | null = null;
let fade: number | null = null;
const listeners = new Set<() => void>();

function element(): HTMLAudioElement {
  if (!audio) {
    audio = new Audio(SRC);
    audio.loop = true;
    audio.preload = "auto";
    audio.volume = 0;
  }
  return audio;
}

/** Eases the volume to `to`, then runs `done`. Cancels any fade in flight. */
function fadeTo(to: number, done?: () => void) {
  const el = element();
  if (fade !== null) window.clearInterval(fade);
  const from = el.volume;
  const started = performance.now();
  fade = window.setInterval(() => {
    const t = Math.min(1, (performance.now() - started) / FADE_MS);
    el.volume = from + (to - from) * t;
    if (t >= 1) {
      window.clearInterval(fade!);
      fade = null;
      done?.();
    }
  }, 30);
}

function play() {
  if (muted || document.hidden) return;
  const el = element();
  // Refused before the first interaction — the unlock listeners below retry.
  el.play()
    .then(() => fadeTo(VOLUME))
    .catch(() => {});
}

function pause() {
  if (!audio || audio.paused) return;
  fadeTo(0, () => audio?.pause());
}

let started = false;

/** Called once, at startup. */
export function startBackgroundMusic() {
  if (started) return;
  started = true;

  // Every tap retries until the first one that actually gets it playing.
  const unlock = () => play();
  window.addEventListener("pointerdown", unlock, true);
  window.addEventListener("keydown", unlock, true);
  element().addEventListener(
    "playing",
    () => {
      window.removeEventListener("pointerdown", unlock, true);
      window.removeEventListener("keydown", unlock, true);
    },
    { once: true }
  );

  // Nobody wants it playing from a tab they have switched away from — and on
  // a phone, from an app they have left.
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) pause();
    else play();
  });

  play();
}

/** The one mute: it silences the card sounds too (see sfx.ts). */
export function isMusicMuted(): boolean {
  return muted;
}

export function setMusicMuted(next: boolean) {
  muted = next;
  try {
    localStorage.setItem(MUTED_KEY, next ? "1" : "0");
  } catch {
    // Private window: it still toggles, it just will not be remembered.
  }
  if (next) pause();
  else play();
  for (const listener of listeners) listener();
}

/** Whether the music is off, for the toggle buttons. */
export function useMusicMuted(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => muted
  );
}
