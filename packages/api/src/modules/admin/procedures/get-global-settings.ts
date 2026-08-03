import { getGlobalSettings } from "@iris/database/drizzle/queries";
import { adminProcedure } from "../../../orpc/procedures";
import {
  getGlobalSettingsOutputSchema,
  maskSecret,
} from "../types";

/**
 * Read the instance-level global settings (R6/R7). The AI API key and the
 * Telegram bot token are masked on read — the real values never leave the
 * server. Defaults are returned for first-boot (unseeded DB) so the UI renders
 * sensibly before `db:seed` runs.
 */
export const getGlobalSettingsProcedure = adminProcedure
  .route({
    method: "GET",
    path: "/admin/global-settings",
    tags: ["Administration"],
    summary: "Get global AI config and defaults (secrets masked)",
  })
  .output(getGlobalSettingsOutputSchema)
  .handler(async () => {
    const row = await getGlobalSettings();

    return {
      success: true as const,
      reason: "Global settings fetched",
      settings: {
        aiBaseUrl: row?.aiBaseUrl ?? "https://api.openai.com/v1",
        aiApiKey: maskSecret(row?.aiApiKey ?? null),
        aiModel: row?.aiModel ?? "gpt-4o-mini",
        pollIntervalDefaultMinutes: row?.pollIntervalDefaultMinutes ?? 60,
        telegramBotToken: maskSecret(row?.telegramBotToken ?? null),
      },
    };
  });
