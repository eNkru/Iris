"use client";

import { useTheme } from "../lib/theme";

/**
 * Dark/light mode toggle for the top nav. Uses ☀️/🌙 glyphs instead of an
 * icon library (ui.tsx convention: dependency-free). While unmounted (SSR)
 * it renders a neutral placeholder to avoid hydration mismatch.
 */
export function ThemeToggle() {
  const { theme, toggleTheme, mounted } = useTheme();

  if (!mounted) {
    return (
      <button
        type="button"
        aria-label="Toggle theme"
        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 bg-white text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
        disabled
      />
    );
  }

  return (
    <button
      type="button"
      aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      onClick={toggleTheme}
      className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 bg-white text-sm text-slate-700 transition-colors hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 focus-visible:ring-offset-1 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 dark:focus-visible:ring-slate-400 dark:focus-visible:ring-offset-slate-950"
    >
      {theme === "dark" ? "☀️" : "🌙"}
    </button>
  );
}
