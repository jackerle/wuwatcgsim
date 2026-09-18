import { useLang } from "../i18n/LanguageContext";

/**
 * The TH/EN tab pair, pinned to the corner of the main menu. Two tabs rather
 * than a dropdown — there are only ever two languages, so showing both at
 * once is one less click than opening a menu to see what the other choice
 * even is.
 */
export function LanguageSwitch() {
  const { lang, setLang, t } = useLang();

  return (
    <div className="lang-switch" role="tablist" aria-label={t("mainMenu.langSwitchTitle")}>
      <button
        type="button"
        role="tab"
        aria-selected={lang === "th"}
        className={lang === "th" ? "on" : ""}
        onClick={() => setLang("th")}
      >
        TH
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={lang === "en"}
        className={lang === "en" ? "on" : ""}
        onClick={() => setLang("en")}
      >
        EN
      </button>
    </div>
  );
}
