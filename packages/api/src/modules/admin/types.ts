import { z } from "zod";
import { aiProviderZodSchema } from "@iris/utils";

/**
 * Admin global settings module schemas (R6/R7 — instance-level AI config +
 * defaults, managed by the admin via `adminProcedure`).
 *
 * The Telegram bot token is write-only from the API's perspective: it is saved
 * on update and NEVER returned in full — `telegramBotToken` in outputs is a
 * masked placeholder (`••••••` + last 4 chars).
 */

export const globalSettingsShapeSchema = z.object({
  aiProvider: aiProviderZodSchema,
  aiModel: z.string(),
  pollIntervalDefaultMinutes: z.number().int(),
  telegramBotToken: z.string().nullable(),
});
export type GlobalSettingsOutput = z.infer<typeof globalSettingsShapeSchema>;

export const getGlobalSettingsOutputSchema = z.object({
  success: z.literal(true),
  reason: z.string(),
  settings: globalSettingsShapeSchema,
});
export type GetGlobalSettingsOutput = z.infer<typeof getGlobalSettingsOutputSchema>;

export const updateGlobalSettingsInputSchema = z.object({
  aiProvider: aiProviderZodSchema.optional(),
  aiModel: z.string().min(1).optional(),
  pollIntervalDefaultMinutes: z.number().int().min(1).max(10080).optional(),
  /**
   * When present and non-empty the token is saved; when absent/empty the stored
   * token is left unchanged (never returned by GET).
   */
  telegramBotToken: z.string().optional(),
});
export type UpdateGlobalSettingsInput = z.infer<typeof updateGlobalSettingsInputSchema>;

/**
 * Mask a stored bot token for API responses. Short/empty tokens degrade to a
 * fixed placeholder; longer tokens keep the last 4 chars for recognition.
 */
export function maskTelegramBotToken(token: string | null): string | null {
  if (!token || token === "") {
    return null;
  }
  if (token.length <= 4) {
    return "••••••";
  }
  return `••••••${token.slice(-4)}`;
}
