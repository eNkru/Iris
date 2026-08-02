import { and, eq } from "drizzle-orm";
import { ORPCError } from "@orpc/server";
import { db } from "@iris/database";
import { alertChannels } from "@iris/database/drizzle/schema/postgres";
import { protectedProcedure } from "../../../orpc/procedures";
import { channelIdInputSchema, deleteChannelOutputSchema } from "../types";

/**
 * Delete a notification channel.
 */
export const deleteChannel = protectedProcedure
  .route({
    method: "DELETE",
    path: "/channels/{id}",
    tags: ["Channels"],
    summary: "Delete a notification channel",
  })
  .input(channelIdInputSchema)
  .output(deleteChannelOutputSchema)
  .handler(async ({ input, context }) => {
    const { id } = input;

    const [existing] = await db
      .select()
      .from(alertChannels)
      .where(and(eq(alertChannels.id, id), eq(alertChannels.userId, context.user.id)));

    if (!existing) {
      throw new ORPCError("NOT_FOUND", { message: "Channel not found" });
    }

    await db.delete(alertChannels).where(eq(alertChannels.id, id));

    return {
      success: true as const,
      reason: "Channel deleted",
    };
  });
