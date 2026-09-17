// What the server has told us about the match, kept outside React.
//
// The board arrives the instant the host presses start — before the component
// that would draw it has mounted, and therefore before any listener inside
// that component exists. Subscribing here, at module load, means the update is
// already waiting when the component turns up. Anything that listens only from
// inside a screen it also has to open is a race.

import type { ChatMessage, MatchUpdate } from "@wuwatcg/shared";
import { socket } from "../socket";

export interface MatchSnapshot {
  update: MatchUpdate | null;
  chat: ChatMessage[];
}

let snapshot: MatchSnapshot = { update: null, chat: [] };
const listeners = new Set<() => void>();

function set(next: MatchSnapshot): void {
  snapshot = next;
  for (const listener of listeners) listener();
}

socket.on("matchUpdate", (update) => set({ ...snapshot, update }));
socket.on("matchEnded", () => set({ ...snapshot, update: null }));
socket.on("chatHistory", (chat) => set({ ...snapshot, chat }));
socket.on("chatMessage", (message) => set({ ...snapshot, chat: [...snapshot.chat, message] }));

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getSnapshot(): MatchSnapshot {
  return snapshot;
}

/** Wipes the board on the way out of a room, so the next one starts clean. */
export function clearMatch(): void {
  set({ update: null, chat: [] });
}
