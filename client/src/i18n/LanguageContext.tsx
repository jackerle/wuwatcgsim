import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { STRINGS, type Lang, type StringKey } from "./strings";

export type { Lang, StringKey };

const KEY = "wuwatcg.lang";

function readStoredLang(): Lang {
  try {
    const raw = localStorage.getItem(KEY);
    return raw === "en" || raw === "th" ? raw : "th";
  } catch {
    // Private window, blocked site data — same starting point every time.
    return "th";
  }
}

/** Looks up one key in one language, calling it if it's a template. */
function resolve(key: StringKey, lang: Lang, args: unknown[]): string {
  const entry = STRINGS[key];
  const value = entry[lang];
  return typeof value === "function" ? (value as (...a: unknown[]) => string)(...args) : value;
}

interface LanguageContextValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  /**
   * Looks up `key` in the current language. Pass whatever the entry's
   * template needs (a count, a name) — see strings.ts for each key's shape.
   */
  t: (key: StringKey, ...args: unknown[]) => string;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

/**
 * Wraps the whole app once, at the root — see main.tsx — so any screen can
 * read or change the language without threading a prop through everything
 * between here and there.
 */
export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(readStoredLang);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    try {
      localStorage.setItem(KEY, next);
    } catch {
      // Best effort — losing it only costs re-picking the language next visit.
    }
  }, []);

  const t = useCallback((key: StringKey, ...args: unknown[]) => resolve(key, lang, args), [lang]);

  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLang(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error("useLang must be used within a LanguageProvider");
  return ctx;
}
