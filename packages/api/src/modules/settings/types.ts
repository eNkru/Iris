import { z } from "zod";
import { aiModelOverrideSchema } from "@iris/utils";

/**
 * Per-user settings module schemas (design.md `settings.*`). The AI model
 * override field is schema-ready but reserved for later (R6); the default poll
 * interval override is editable (R7).
 */

export const userSettingsOutputSchema = z.object({
  userId: z.string(),
  aiModelOverride: aiModelOverrideSchema,
  pollIntervalDefaultMinutes: z.number().int().nullable(),
  createdAt: z.date().nullable(),
  updatedAt: z.date().nullable(),
});
export type UserSettingsOutput = z.infer<typeof userSettingsOutputSchema>;

export const updateUserSettingsInputSchema = z.object({
  aiModelOverride: aiModelOverrideSchema.optional(),
  /** null = fall back to the instance global default (R7). */
  pollIntervalDefaultMinutes: z.number().int().min(1).max(10080).nullable().optional(),
});
export type UpdateUserSettingsInput = z.infer<typeof updateUserSettingsInputSchema>;

export const getUserSettingsOutputSchema = z.object({
  success: z.literal(true),
  reason: z.string(),
  settings: userSettingsOutputSchema,
});
export type GetUserSettingsOutput = z.infer<typeof getUserSettingsOutputSchema>;
