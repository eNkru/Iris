"use client";

import { useState } from "react";

/**
 * Setup guidance for connecting a Telegram bot + chat id (design.md —
 * "Send summary to Telegram"). Rendered in an on-hover tooltip next to the
 * action that depends on a configured channel.
 */
export const TELEGRAM_SETUP_STEPS = [
  "Create a bot: message @BotFather and send /newbot, then copy the bot token.",
  "Configure the token: set it in Settings → Global settings (admin) or the TELEGRAM_BOT_TOKEN env var.",
  "Find your chat id: message your bot /start, then the chat id appears in the reply.",
  "Connect: add the chat id under Settings → Alert channels.",
] as const;

export function TelegramHelpTooltip({
  title = "How to connect Telegram",
}: {
  title?: string;
}) {
  const [open, setOpen] = useState(false);

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
        aria-label="Show Telegram setup help"
        className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-slate-300 text-xs font-semibold text-slate-500 transition-colors hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500"
      >
        ?
      </button>
      {open ? (
        <span
          role="tooltip"
          className="absolute bottom-full left-0 z-10 mb-2 w-72 rounded-md border border-slate-200 bg-white p-3 text-xs text-slate-700 shadow-lg"
        >
          <span className="mb-1.5 block font-semibold text-slate-900">{title}</span>
          <ol className="list-decimal space-y-1 pl-4">
            {TELEGRAM_SETUP_STEPS.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </span>
      ) : null}
    </span>
  );
}
