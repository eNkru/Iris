import { eq } from "drizzle-orm";
import { db } from "@iris/database";
import { alertChannels } from "@iris/database/drizzle/schema/postgres";
import { protectedProcedure } from "../../../orpc/procedures";
import { toChannelOutput } from "../lib/format";
import { listChannelsOutputSchema } from "../types";

/**
 * List the current user's notification channels (R11).
 */
export const listChannels = protectedProcedure
  .route({
    method: "GET",
    path: "/channels",
    tags: ["Channels"],
    summary: "List the user's notification channels",
  })
  .output(listChannelsOutputSchema)
  .handler(async ({ context }) => {
    const rows = await db
      .select()
      .from(alertChannels)
      .where(eq(alertChannels.userId, context.user.id))
      .orderBy(alertChannels.createdAt);

    return {
      success: true as const,
      reason: "Channels fetched",
      channels: rows.map(toChannelOutput),
    };
  });
