// Real paths for the top-level menu screens, so a link to /play or /decks
// opens straight to that screen and the browser's own Back button works —
// without pulling in a router for what is, underneath, three screens.
//
// Deliberately scoped to just those three (menu, play, decks): a room or a
// running match is server-driven state, not a page you'd want Back to step
// through — pressing it mid-match should not silently half-leave a room.
// Leaving one is what the "ออกจากห้อง" button is for.

export type Screen = "menu" | "play" | "decks";

const PATH_FOR_SCREEN: Record<Screen, string> = {
  menu: "/",
  play: "/play",
  decks: "/decks",
};

export function screenFromPath(pathname: string): Screen {
  if (pathname === "/play") return "play";
  if (pathname === "/decks" || pathname === "/deck") return "decks";
  return "menu";
}

export function pathForScreen(screen: Screen): string {
  return PATH_FOR_SCREEN[screen];
}

/**
 * Hotseat — both sides on one screen, no server involved — gets its own
 * path rather than living only behind the `?play` query param it used to.
 * It isn't one of the Screen union's three: it's an override that replaces
 * the whole menu system while it's on, the same way a room or a running
 * match does.
 */
export const SELF_PLAY_PATH = "/self-play";

export function isSelfPlayPath(pathname: string): boolean {
  return pathname === SELF_PLAY_PATH;
}
