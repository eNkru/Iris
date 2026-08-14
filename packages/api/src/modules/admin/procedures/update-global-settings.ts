import {
  getGlobalSettings,
  upsertGlobalSettings,
  type GlobalSettingsInput,
} from "@iris/database/drizzle/queries";
import { adminProcedure } from "../../../orpc/procedures";
import {
  getGlobalSettingsOutputSchema,
  maskSecret,
  updateGlobalSettingsInputSchema,
} from "../types";

/**
 * Update the instance-level global settings (singleton row id = 1). Fields are
 * merged over the stored values, so partial updates never clobber the rest.
 * The AI API key and the Telegram bot token are write-only: saved only when a
 * non-empty value is submitted, and always masked in the response.
 */
export const updateGlobalSettingsProcedure = adminProcedure
  .route({
    method: "PATCH",
    path: "/admin/global-settings",
    tags: ["Administration"],
    summary: "Update global AI config and defaults",
  })
  .input(updateGlobalSettingsInputSchema)
  .output(getGlobalSettingsOutputSchema)
  .handler(async ({ input }) => {
    const row = await getGlobalSettings();

    const merged: GlobalSettingsInput = {
      aiBaseUrl: input.aiBaseUrl ?? row?.aiBaseUrl ?? "https://api.openai.com/v1",
      aiModel: input.aiModel ?? row?.aiModel ?? "gpt-4o-mini",
      pollIntervalDefaultMinutes:
        input.pollIntervalDefaultMinutes ?? row?.pollIntervalDefaultMinutes ?? 60,
      aiZenHost: input.aiZenHost ?? row?.aiZenHost ?? "opencode.ai",
      aiUserAgent:
        input.aiUserAgent ??
        row?.aiUserAgent ??
        "opencode/1.18.12 ai-sdk/provider-utils/4.0.23 runtime/bun/1.3.13",
      aiClientHeader: input.aiClientHeader ?? row?.aiClientHeader ?? "cli",
    };

    // Write-only secrets: save only when a non-empty value is submitted.
    if (input.aiApiKey !== undefined && input.aiApiKey.trim() !== "") {
      merged.aiApiKey = input.aiApiKey;
    }
    if (input.telegramBotToken !== undefined && input.telegramBotToken.trim() !== "") {
      merged.telegramBotToken = input.telegramBotToken;
    }

    const updated = await upsertGlobalSettings(merged);

    return {
      success: true as const,
      reason: "Global settings updated",
      settings: {
        aiBaseUrl: updated?.aiBaseUrl ?? merged.aiBaseUrl ?? "https://api.openai.com/v1",
        aiApiKey: maskSecret(updated?.aiApiKey ?? null),
        aiModel: updated?.aiModel ?? merged.aiModel ?? "gpt-4o-mini",
        pollIntervalDefaultMinutes:
          updated?.pollIntervalDefaultMinutes ?? merged.pollIntervalDefaultMinutes ?? 60,
        telegramBotToken: maskSecret(updated?.telegramBotToken ?? null),
        aiZenHost: updated?.aiZenHost ?? merged.aiZenHost ?? "opencode.ai",
        aiUserAgent:
          updated?.aiUserAgent ??
          merged.aiUserAgent ??
          "opencode/1.18.12 ai-sdk/provider-utils/4.0.23 runtime/bun/1.3.13",
        aiClientHeader: updated?.aiClientHeader ?? merged.aiClientHeader ?? "cli",
      },
    };
  });
