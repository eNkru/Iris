import { z } from "zod";

/**
 * Single source of truth for enum values.
 *
 * The database package imports these tuples to define SQLite CHECK constraints,
 * and application code imports the Zod schemas / types from here — never from
 * the database package (which owns the database driver).
 */

// Alert notification channel registry (R11)
export const CHANNEL_TYPE_VALUES = ["telegram", "email"] as const;
export const channelTypeZodSchema = z.enum(CHANNEL_TYPE_VALUES);
export type ChannelType = z.infer<typeof channelTypeZodSchema>;

// Notification message language, stored per alert channel in
// `alert_channels.config.language` (no schema migration needed).
export const LANGUAGE_VALUES = ["en", "zh"] as const;
export const languageZodSchema = z.enum(LANGUAGE_VALUES);
export type Language = z.infer<typeof languageZodSchema>;

// AI config is generic OpenAI-compatible (base URL + API key + model); there is
// no provider enum. See packages/prices/src/pipeline/ai-extract.ts and
// .trellis/spec/backend/ai-sdk-integration.md.
