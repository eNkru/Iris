import { z } from "zod";
import { channelTypeZodSchema } from "@iris/utils";
import { okResultSchema } from "../shared";

/**
 * Alert channels module schemas (R11 — registry + adapters). MVP channel type
 * is `telegram` only (R12); the enum value comes from @iris/utils so adding
 * `email` later is purely additive.
 */

// --- Input schemas ---

export const createChannelInputSchema = z.object({
  channelType: z.literal("telegram"),
  /** Telegram chat id — digits only. Stored in `alert_channels.config.chatId`. */
  chatId: z.string().regex(/^\d+$/, "chatId must be a string of digits"),
});
export type CreateChannelInput = z.infer<typeof createChannelInputSchema>;

export const updateChannelInputSchema = z.object({
  id: z.string().uuid(),
  enabled: z.boolean().optional(),
  chatId: z.string().regex(/^\d+$/, "chatId must be a string of digits").optional(),
});
export type UpdateChannelInput = z.infer<typeof updateChannelInputSchema>;

export const channelIdInputSchema = z.object({
  id: z.string().uuid(),
});
export type ChannelIdInput = z.infer<typeof channelIdInputSchema>;

// --- Output schemas ---

export const channelOutputSchema = z.object({
  id: z.string(),
  userId: z.string(),
  channelType: channelTypeZodSchema,
  config: z.record(z.string(), z.unknown()),
  enabled: z.boolean(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type ChannelOutput = z.infer<typeof channelOutputSchema>;

export const listChannelsOutputSchema = z.object({
  success: z.literal(true),
  reason: z.string(),
  channels: z.array(channelOutputSchema),
});
export type ListChannelsOutput = z.infer<typeof listChannelsOutputSchema>;

export const createChannelOutputSchema = z.object({
  success: z.literal(true),
  reason: z.string(),
  channel: channelOutputSchema,
});
export type CreateChannelOutput = z.infer<typeof createChannelOutputSchema>;

export const updateChannelOutputSchema = z.object({
  success: z.literal(true),
  reason: z.string(),
  channel: channelOutputSchema,
});
export type UpdateChannelOutput = z.infer<typeof updateChannelOutputSchema>;

export const deleteChannelOutputSchema = okResultSchema;
export type DeleteChannelOutput = z.infer<typeof deleteChannelOutputSchema>;
