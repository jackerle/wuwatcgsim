// What the board needs from a match, whoever is running it.
//
// Two things implement this: useLocalMatch, which runs the engine in this tab
// for two people sharing a screen, and useNetMatch, which sends moves to the
// server and draws whatever comes back. The board itself cannot tell them
// apart, which is the point — the rules live in one place either way.

import type {
  ChatMessage,
  ChoiceAnswer,
  MatchIntent,
  MatchState,
  PendingChoice,
  ResolvedEffect,
  Seat,
} from "@wuwatcg/shared";

export interface MatchController {
  /** The board as the current viewer is allowed to see it. */
  shown: MatchState;
  /** The open question, if it is this viewer's to answer. */
  pending: PendingChoice | null;
  /** Who is being asked, so the other side sees why nothing is moving. */
  askingSeat: string | null;
  /** Effects with no code written — the players apply these themselves. */
  manual: ResolvedEffect[];
  log: string[];
  error: string | null;

  names: Record<string, string>;
  connected: Record<string, boolean>;

  /** Whose hand is face-up right now. */
  viewing: Seat;
  setViewing: (seat: Seat) => void;
  /**
   * Whether the viewer may flip to the other side. True on one shared screen,
   * false over the network — there, flipping would just be looking at cards
   * the client was never sent.
   */
  canFlip: boolean;
  /** The seats this client is allowed to play. */
  controls: Seat[];

  send: (playerId: string, intent: MatchIntent) => void;
  answer: (choice: ChoiceAnswer) => void;
  /**
   * Abandons the open question, putting the board back where it was.
   *
   * Only the player whose move raised it may do this, which is what
   * `canCancel` reports. It is the way out of a question that cannot be
   * answered — the card it belongs to has a bug, or the player it was put to
   * has walked away — and without it the modal is a dead end.
   */
  cancel: () => void;
  canCancel: boolean;
  restart: () => void;
  /** Whether this client may deal a new game (the host, over the network). */
  canRestart: boolean;

  /** null when there is nobody to talk to — both players are at one screen. */
  chat: ChatMessage[] | null;
  sendChat: (text: string) => void;
}

export const SEAT_FALLBACK_NAMES: Record<string, string> = {
  p1: "ผู้เล่น 1",
  p2: "ผู้เล่น 2",
};
