import { ORPCError } from "@orpc/server";
import { db } from "@iris/database";
import { alertChannels } from "@iris/database/drizzle/schema/sqlite";
import { protectedProcedure } from "../../../orpc/procedures";
import { toChannelOutput } from "../lib/format";
import { createChannelInputSchema, createChannelOutputSchema } from "../types";

/**
 * Add a notification channel (R11/R12 — MVP telegram). `(userId, channelType)`
 * is unique, so a duplicate create is rejected atomically via the constraint
 * (no check-then-insert race).
 */
export const createChannel = protectedProcedure
  .route({
    method: "POST",
    path: "/channels",
    tags: ["Channels"],
    summary: "Add a notification channel",
  })
  .input(createChannelInputSchema)
  .output(createChannelOutputSchema)
  .handler(async ({ input, context }) => {
    const { channelType, chatId, language } = input;

    const [row] = await db
      .insert(alertChannels)
      .values({
        userId: context.user.id,
        channelType,
        config: language ? { chatId, language } : { chatId },
        enabled: true,
      })
      .onConflictDoNothing({
        target: [alertChannels.userId, alertChannels.channelType],
      })
      .returning();

    if (!row) {
      throw new ORPCError("CONFLICT", {
        message: `A ${channelType} channel is already configured`,
      });
    }

    return {
      success: true as const,
      reason: "Channel added",
      channel: toChannelOutput(row),
    };
  });
