import { z } from "zod";

/**
 * Single source of truth for enum values.
 *
 * The database package imports these tuples to define PostgreSQL enum types,
 * and application code imports the Zod schemas / types from here — never from
 * the database package (which pulls in the pg client).
 */

// Alert notification channel registry (R11)
export const CHANNEL_TYPE_VALUES = ["telegram", "email"] as const;
export const channelTypeZodSchema = z.enum(CHANNEL_TYPE_VALUES);
export type ChannelType = z.infer<typeof channelTypeZodSchema>;

// AI provider registry (R6)
export const AI_PROVIDER_VALUES = ["openai", "gemini", "anthropic", "opencode"] as const;
export const aiProviderZodSchema = z.enum(AI_PROVIDER_VALUES);
export type AiProvider = z.infer<typeof aiProviderZodSchema>;
