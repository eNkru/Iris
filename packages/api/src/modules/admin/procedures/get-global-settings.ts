import { getGlobalSettings } from "@iris/database/drizzle/queries";
import { adminProcedure } from "../../../orpc/procedures";
import {
  getGlobalSettingsOutputSchema,
  maskTelegramBotToken,
} from "../types";

/**
 * Read the instance-level global settings (R6/R7). The Telegram bot token is
 * masked on read — the real value never leaves the server (design.md
 * "telegramBotToken — used server-side; masked on read").
 */
export const getGlobalSettingsProcedure = adminProcedure
  .route({
    method: "GET",
    path: "/admin/global-settings",
    tags: ["Administration"],
    summary: "Get global AI config and defaults (bot token masked)",
  })
  .output(getGlobalSettingsOutputSchema)
  .handler(async () => {
    const row = await getGlobalSettings();

    return {
      success: true as const,
      reason: "Global settings fetched",
      settings: {
        aiProvider: row?.aiProvider ?? "openai",
        aiModel: row?.aiModel ?? "gpt-4o-mini",
        pollIntervalDefaultMinutes: row?.pollIntervalDefaultMinutes ?? 60,
        telegramBotToken: maskTelegramBotToken(row?.telegramBotToken ?? null),
      },
    };
  });
