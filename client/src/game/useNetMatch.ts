// A match played against someone else, run on the server.
//
// Nothing here decides anything: every move is an emit, and the board is
// whatever the server last sent. That is deliberate. The client holds no
// copy of the rules to disagree with, and it is never sent the other hand in
// the first place, so there is no hidden information for a devtools console
// to dig out.

import { useCallback, useMemo, useSyncExternalStore } from "react";
import type { ChoiceAnswer, MatchIntent, Seat } from "@wuwatcg/shared";
import { socket } from "../socket";
import { getSnapshot, subscribe } from "./matchStore";
import { SEAT_FALLBACK_NAMES, type MatchController } from "./matchController";

export interface NetMatchOptions {
  /** Only the host may deal a new game. */
  isHost: boolean;
}

/** Null until the server has sent a board — there is nothing to draw before. */
export function useNetMatch({ isHost }: NetMatchOptions): MatchController | null {
  // The store is listening from module load, so whatever arrived before this
  // screen mounted is already here.
  const { update, chat } = useSyncExternalStore(subscribe, getSnapshot);

  // The seat is fixed by the server, so these never need an argument: whatever
  // the UI thinks it is acting as, the socket decides who is really speaking.
  const send = useCallback((_playerId: string, intent: MatchIntent) => {
    socket.emit("matchIntent", { intent });
  }, []);
  const answer = useCallback((choice: ChoiceAnswer) => {
    socket.emit("matchAnswer", { answer: choice });
  }, []);
  const cancel = useCallback(() => socket.emit("cancelChoice"), []);
  const restart = useCallback(() => socket.emit("restartMatch"), []);
  const sendChat = useCallback((text: string) => socket.emit("sendChat", { text }), []);
  const setViewing = useCallback((_seat: Seat) => {}, []);

  return useMemo(() => {
    if (!update) return null;
    return {
      shown: update.view,
      pending: update.pending,
      askingSeat: update.askingSeat,
      manual: update.manual,
      log: update.log,
      error: update.error,
      names: { ...SEAT_FALLBACK_NAMES, ...update.names },
      connected: update.connected,
      viewing: update.seat,
      setViewing,
      // The other hand was never sent, so there is nothing to flip to.
      canFlip: false,
      controls: [update.seat],
      send,
      answer,
      cancel,
      // The move is this seat's, so dropping it is this seat's to do.
      canCancel: update.actorSeat === update.seat,
      restart,
      canRestart: isHost,
      chat,
      sendChat,
    };
  }, [update, chat, isHost, send, answer, cancel, restart, sendChat, setViewing]);
}
