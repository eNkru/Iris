"use client";

import { useI18n } from "../lib/i18n";
import { SegmentedControl } from "./ui";

/**
 * English / 中文 language switch for the top nav (dependency-free, mirrors the
 * theme toggle). Uses the shared SegmentedControl from ui.tsx.
 */
const LANGUAGE_OPTIONS = [
  { value: "en", label: "EN" },
  { value: "zh", label: "中文" },
] as const;

export function LanguageToggle() {
  const { lang, setLang, mounted, t } = useI18n();

  if (!mounted) {
    return (
      <div className="h-8 w-24 rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900" />
    );
  }

  return (
    <SegmentedControl
      label={t("nav.language")}
      options={LANGUAGE_OPTIONS}
      value={lang}
      onChange={(value) => setLang(value)}
    />
  );
}
