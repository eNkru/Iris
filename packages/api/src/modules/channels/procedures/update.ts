import { and, eq } from "drizzle-orm";
import { ORPCError } from "@orpc/server";
import { db } from "@iris/database";
import { alertChannels } from "@iris/database/drizzle/schema/sqlite";
import { protectedProcedure } from "../../../orpc/procedures";
import { asRecord } from "../../shared";
import { toChannelOutput } from "../lib/format";
import { updateChannelInputSchema, updateChannelOutputSchema } from "../types";

/**
 * Update a notification channel: enable/disable, or replace the stored chatId.
 * The rest of `config` is preserved when only `chatId` changes.
 */
export const updateChannel = protectedProcedure
  .route({
    method: "PATCH",
    path: "/channels/{id}",
    tags: ["Channels"],
    summary: "Update a notification channel",
  })
  .input(updateChannelInputSchema)
  .output(updateChannelOutputSchema)
  .handler(async ({ input, context }) => {
    const { id, enabled, chatId, language } = input;

    const [existing] = await db
      .select()
      .from(alertChannels)
      .where(and(eq(alertChannels.id, id), eq(alertChannels.userId, context.user.id)));

    if (!existing) {
      throw new ORPCError("NOT_FOUND", { message: "Channel not found" });
    }

    const set: Partial<typeof alertChannels.$inferSelect> = { updatedAt: new Date() };
    if (enabled !== undefined) {
      set.enabled = enabled;
    }

    // Merge any config edits (chatId and/or language) into the stored config,
    // preserving the rest. A missing language keeps the stored value; a stored
    // value absent from config reads as `en` at notification time.
    const configUpdates: Record<string, unknown> = {};
    if (chatId !== undefined) {
      configUpdates.chatId = chatId;
    }
    if (language !== undefined) {
      configUpdates.language = language;
    }
    if (Object.keys(configUpdates).length > 0) {
      set.config = { ...asRecord(existing.config), ...configUpdates };
    }

    const [updated] = await db
      .update(alertChannels)
      .set(set)
      .where(eq(alertChannels.id, id))
      .returning();

    if (!updated) {
      throw new ORPCError("INTERNAL_SERVER_ERROR", {
        message: "Failed to update the channel",
      });
    }

    return {
      success: true as const,
      reason: "Channel updated",
      channel: toChannelOutput(updated),
    };
  });
