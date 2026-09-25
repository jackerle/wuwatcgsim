// A desktop notification when someone takes the empty seat.
//
// Waiting on a public room means waiting on a stranger, which can take long
// enough to go and do something else. The browser's Notification API puts
// the news where the player is — Windows' Action Center, macOS' Notification
// Center — instead of in a tab they are not looking at.
//
// Only when they are not looking: a notification about something already on
// screen is noise. And only with permission, which a browser grants per site
// and only when asked from a click (Safari refuses to ask otherwise), so the
// lobby offers a button rather than asking the moment it opens.

import { useEffect, useRef, useState } from "react";
import type { Room } from "@wuwatcg/shared";

export type NoticePermission = NotificationPermission | "unsupported";

function currentPermission(): NoticePermission {
  return typeof Notification === "undefined" ? "unsupported" : Notification.permission;
}

/**
 * Watches the room and notifies when it fills up with someone other than
 * `me`. Returns the permission as it stands and a way to ask for it.
 */
export function useJoinNotice(
  room: Room,
  me: string,
  text: (name: string) => { title: string; body: string }
): { permission: NoticePermission; ask: () => void } {
  const [permission, setPermission] = useState<NoticePermission>(currentPermission);
  const seen = useRef(new Set(room.players.map((player) => player.id)));
  const textRef = useRef(text);
  textRef.current = text;

  useEffect(() => {
    const arrived = room.players.filter((player) => player.id !== me && !seen.current.has(player.id));
    seen.current = new Set(room.players.map((player) => player.id));
    if (arrived.length === 0 || currentPermission() !== "granted") return;
    if (document.visibilityState === "visible" && document.hasFocus()) return;

    const { title, body } = textRef.current(arrived[0].name);
    try {
      const notice = new Notification(title, { body, icon: "/cards/backcard.png", tag: `room-${room.code}` });
      // Clicking it brings the player back to the tab that is waiting.
      notice.onclick = () => {
        window.focus();
        notice.close();
      };
    } catch {
      // Some mobile browsers expose the API but only allow it from a service
      // worker. The lobby still shows the player arriving; nothing is lost.
    }
  }, [room, me]);

  const ask = () => {
    if (typeof Notification === "undefined") return;
    void Notification.requestPermission().then(setPermission);
  };

  return { permission, ask };
}
