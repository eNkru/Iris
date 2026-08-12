"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { LANG_COOKIE_NAME, LANG_STORAGE_KEY, t, type DictKey, type Lang } from "./dictionary";

/**
 * Language context (frontend/state-management.md — UI language is appearance
 * state, same pattern as the theme context). Persisted to localStorage
 * (`iris.lang`); a matching cookie (`iris.lang`) lets server components render
 * translated headings and set `<html lang>`. Default is English.
 */

function readStoredLang(): Lang | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const stored = window.localStorage.getItem(LANG_STORAGE_KEY);
    return stored === "en" || stored === "zh" ? stored : null;
  } catch {
    return null;
  }
}

function writeLangCookie(lang: Lang): void {
  document.cookie = `${LANG_COOKIE_NAME}=${lang}; path=/; max-age=31536000; samesite=lax`;
}

interface I18nContextValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  /** Translate a dictionary key; `vars` interpolates `{name}` placeholders. */
  t: (key: DictKey, vars?: Record<string, string | number>) => string;
  /** False until the provider has mounted client-side (avoids SSR icon flicker). */
  mounted: boolean;
}

const I18nContext = createContext<I18nContextValue>({
  lang: "en",
  setLang: () => {},
  t: (key) => key as string,
  mounted: false,
});

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => readStoredLang() ?? "en");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
  }, [lang]);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    try {
      window.localStorage.setItem(LANG_STORAGE_KEY, next);
    } catch {
      // Storage unavailable (e.g. private mode) — language still applies this session.
    }
    writeLangCookie(next);
  }, []);

  const translate = useCallback(
    (key: DictKey, vars?: Record<string, string | number>) => t(lang, key, vars),
    [lang],
  );

  return (
    <I18nContext.Provider value={{ lang, setLang, t: translate, mounted }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n(): I18nContextValue {
  return useContext(I18nContext);
}
