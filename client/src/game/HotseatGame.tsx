import type { Seat } from "@wuwatcg/shared";
import { PlayGame } from "./PlayGame";
import { useLocalMatch } from "./useLocalMatch";

/** Two players, one screen, no server involved. */
export function HotseatGame({ picks }: { picks: Record<Seat, string> }) {
  const match = useLocalMatch({ picks });
  return <PlayGame match={match} />;
}
