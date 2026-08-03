import { z } from "zod";

/**
 * Admin global settings module schemas (R6/R7 — instance-level AI config +
 * defaults, managed by the admin via `adminProcedure`).
 *
 * The AI config is generic OpenAI-compatible: base URL + API key + model, all
 * stored in `global_settings`. The API key and the Telegram bot token are
 * write-only from the API's perspective: they are saved on update and NEVER
 * returned in full — outputs return a masked placeholder (`••••••` + last 4
 * chars) via `maskSecret`.
 */

export const globalSettingsShapeSchema = z.object({
  aiBaseUrl: z.string().url(),
  aiApiKey: z.string().nullable(),
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
  aiBaseUrl: z.string().url().optional(),
  /**
   * When present and non-empty the key is saved; when absent/empty the stored
   * key is left unchanged (never returned by GET, only the masked value).
   */
  aiApiKey: z.string().optional(),
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
 * Mask a stored secret (API key, bot token) for API responses. Short/empty
 * values degrade to a fixed placeholder; longer values keep the last 4 chars
 * for recognition. The real value never leaves the server.
 */
export function maskSecret(value: string | null): string | null {
  if (!value || value === "") {
    return null;
  }
  if (value.length <= 4) {
    return "••••••";
  }
  return `••••••${value.slice(-4)}`;
}
