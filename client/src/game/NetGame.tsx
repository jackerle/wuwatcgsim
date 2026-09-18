import { PlayGame } from "./PlayGame";
import { useNetMatch } from "./useNetMatch";
import { useLang } from "../i18n/LanguageContext";

/**
 * A match against someone else, drawn from whatever the server last sent.
 *
 * The board can legitimately be missing for a moment — right after a refresh,
 * before the rejoin round-trip comes back — so this waits rather than
 * rendering an empty table.
 */
export function NetGame({ isHost, onLeave }: { isHost: boolean; onLeave: () => void }) {
  const { t } = useLang();
  const match = useNetMatch({ isHost });

  if (!match) {
    return (
      <div className="page">
        <div className="card">
          <p className="status">{t("netGame.connecting")}</p>
        </div>
      </div>
    );
  }

  return (
    <PlayGame match={match}>
      <button type="button" onClick={onLeave}>
        {t("common.leaveRoom")}
      </button>
    </PlayGame>
  );
}
