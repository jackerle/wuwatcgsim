import { setMusicMuted, useMusicMuted } from "./bgm";
import { useLang } from "../i18n/LanguageContext";

/** The speaker button beside the language tabs on the main menu. */
export function MusicToggle() {
  const { t } = useLang();
  const muted = useMusicMuted();
  const label = muted ? t("music.turnOn") : t("music.turnOff");

  return (
    <button
      type="button"
      className={`music-toggle ${muted ? "off" : "on"}`}
      aria-pressed={!muted}
      title={label}
      aria-label={label}
      onClick={() => setMusicMuted(!muted)}
    >
      <SpeakerIcon muted={muted} />
    </button>
  );
}

export function SpeakerIcon({ muted }: { muted: boolean }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor" />
      {muted ? (
        <path d="M16 9.5l5 5M21 9.5l-5 5" />
      ) : (
        <>
          <path d="M15.5 9a4 4 0 010 6" />
          <path d="M18.5 6.5a7.5 7.5 0 010 11" />
        </>
      )}
    </svg>
  );
}
