import {
  getGlobalSettings,
  upsertGlobalSettings,
  type GlobalSettingsInput,
} from "@iris/database/drizzle/queries";
import { adminProcedure } from "../../../orpc/procedures";
import {
  getGlobalSettingsOutputSchema,
  maskTelegramBotToken,
  updateGlobalSettingsInputSchema,
} from "../types";

/**
 * Update the instance-level global settings (singleton row id = 1). Fields are
 * merged over the stored values, so partial updates never clobber the rest.
 * The bot token is saved only when non-empty and always masked in the response.
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
      aiProvider: input.aiProvider ?? row?.aiProvider ?? "openai",
      aiModel: input.aiModel ?? row?.aiModel ?? "gpt-4o-mini",
      pollIntervalDefaultMinutes:
        input.pollIntervalDefaultMinutes ?? row?.pollIntervalDefaultMinutes ?? 60,
    };

    if (input.telegramBotToken !== undefined && input.telegramBotToken.trim() !== "") {
      merged.telegramBotToken = input.telegramBotToken;
    }

    const updated = await upsertGlobalSettings(merged);

    return {
      success: true as const,
      reason: "Global settings updated",
      settings: {
        aiProvider: updated?.aiProvider ?? merged.aiProvider ?? "openai",
        aiModel: updated?.aiModel ?? merged.aiModel ?? "gpt-4o-mini",
        pollIntervalDefaultMinutes:
          updated?.pollIntervalDefaultMinutes ?? merged.pollIntervalDefaultMinutes ?? 60,
        telegramBotToken: maskTelegramBotToken(updated?.telegramBotToken ?? null),
      },
    };
  });
