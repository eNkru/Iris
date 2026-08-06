"use client";

import { useState } from "react";
import { useI18n } from "../lib/i18n";

/**
 * Setup guidance for connecting a Telegram bot + chat id (design.md —
 * "Send summary to Telegram"). Rendered in an on-hover tooltip next to the
 * action that depends on a configured channel. The step keys are resolved
 * through `useI18n` (the tooltip always renders inside the language provider).
 */
const STEP_KEYS = ["tooltip.step1", "tooltip.step2", "tooltip.step3", "tooltip.step4"] as const;

export function TelegramHelpTooltip({
  title,
}: {
  title?: string;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const heading = title ?? t("tooltip.title");

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      <button
        type="button"
        aria-label={t("tooltip.aria")}
        className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-slate-300 text-xs font-semibold text-slate-500 transition-colors hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:focus-visible:ring-slate-400"
      >
        ?
      </button>
      {open ? (
        <span
          role="tooltip"
          className="absolute bottom-full left-0 z-10 mb-2 w-72 rounded-md border border-slate-200 bg-white p-3 text-xs text-slate-700 shadow-lg dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300"
        >
          <span className="mb-1.5 block font-semibold text-slate-900 dark:text-slate-100">
            {heading}
          </span>
          <ol className="list-decimal space-y-1 pl-4">
            {STEP_KEYS.map((key) => (
              <li key={key}>{t(key)}</li>
            ))}
          </ol>
        </span>
      ) : null}
    </span>
  );
}