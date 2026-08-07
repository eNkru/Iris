"use client";

import { useI18n } from "../lib/i18n";
import { useTheme } from "../lib/theme";

/**
 * Dark/light mode toggle for the top nav. Uses ☀️/🌙 glyphs instead of an
 * icon library (ui.tsx convention: dependency-free). While unmounted (SSR)
 * it renders a neutral placeholder to avoid hydration mismatch.
 */
export function ThemeToggle() {
  const { theme, toggleTheme, mounted } = useTheme();
  const { t } = useI18n();

  const label =
    theme === "dark" ? t("nav.toggleTheme.dark") : t("nav.toggleTheme");

  if (!mounted) {
    return (
      <button
        type="button"
        aria-label={t("nav.toggleTheme")}
        className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-sm text-slate-700 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
        disabled
      />
    );
  }

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={toggleTheme}
      className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-sm text-slate-700 shadow-sm transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-1 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 dark:focus-visible:ring-offset-slate-950"
    >
      {theme === "dark" ? "☀️" : "🌙"}
    </button>
  );
}
