// Match-management controls deliberately live outside the phase navigation.
//
// Concede, deal again and leave a room are about the match as a whole, not
// this turn. Keeping them in a small gear menu at the control bar's left edge
// (ControlBar's `leading`) leaves Draw > Main > Battle > Judgement > End as
// the entire phase track.

import { useState } from "react";
import { useDismiss } from "../board/CardMenu";
import { useLang } from "../i18n/LanguageContext";
import { setMusicMuted, useMusicMuted } from "../audio/bgm";
import { SpeakerIcon } from "../audio/MusicToggle";

export function MatchSettings({
  onConcede,
  canRestart,
  onRestart,
  onLeave,
}: {
  onConcede: () => void;
  canRestart: boolean;
  onRestart: () => void;
  /**
   * Online and vs-bot. Owned by whoever started the match (App's socket
   * lifecycle, BotGame's setup screen), not the controller.
   */
  onLeave?: (() => void) | null;
}) {
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  const rootRef = useDismiss(open, () => setOpen(false));
  const musicMuted = useMusicMuted();
  const pick = (action: () => void) => {
    setOpen(false);
    action();
  };

  return (
    <div ref={rootRef} className="match-settings">
      <button
        type="button"
        className="match-settings-gear"
        title={t("playGame.settingsTitle")}
        aria-label={t("playGame.settingsTitle")}
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        ⚙
      </button>
      {open && (
        <div className="match-settings-menu" role="menu" aria-label={t("playGame.settings")}>
          {/* A toggle, so the menu stays open: it is flipped and heard, not
              an action that moves the screen on. */}
          <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={!musicMuted}
            className="match-settings-music"
            onClick={() => setMusicMuted(!musicMuted)}
          >
            <SpeakerIcon muted={musicMuted} />
            {musicMuted ? t("music.off") : t("music.on")}
          </button>
          <button type="button" className="danger" role="menuitem" onClick={() => pick(onConcede)}>
            {t("controlBar.concede")}
          </button>
          {canRestart && (
            <button type="button" role="menuitem" onClick={() => pick(onRestart)}>
              {t("playGame.newGame")}
            </button>
          )}
          {onLeave && (
            <button type="button" role="menuitem" onClick={() => pick(onLeave)}>
              {t("common.leaveRoom")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
