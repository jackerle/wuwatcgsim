// Who this browser is, across refreshes.
//
// A socket id is not an identity: it changes every time the page reloads, and
// a player who reloads mid-match would come back as a stranger and find their
// own seat taken. This id is generated once, kept in localStorage, and sent
// with every join — it is what lets someone sit back down.

const PLAYER_KEY = "wuwatcg.playerId";
const NAME_KEY = "wuwatcg.playerName";
const ROOM_KEY = "wuwatcg.roomCode";

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    // Private windows and blocked site data both throw here. Losing the id
    // only costs a rejoin, so it is not worth failing over.
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Same as above: best effort.
  }
}

export function playerId(): string {
  const existing = read(PLAYER_KEY);
  if (existing) return existing;
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `p-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  write(PLAYER_KEY, id);
  return id;
}

export const rememberedName = () => read(NAME_KEY) ?? "";
export const rememberName = (name: string) => write(NAME_KEY, name);

/** The room to try to walk back into after a refresh. */
export const rememberedRoom = () => read(ROOM_KEY);
export const rememberRoom = (code: string | null) => write(ROOM_KEY, code);
