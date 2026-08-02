import { eq } from "drizzle-orm";
import { db } from "@iris/database";
import { userSettings } from "@iris/database/drizzle/schema/postgres";
import { protectedProcedure } from "../../../orpc/procedures";
import { getUserSettingsOutputSchema } from "../types";

/**
 * Get the current user's settings. A missing `user_settings` row (no upsert
 * yet) is returned as defaults — the schema stays stable and the UI renders
 * the global defaults.
 */
export const getUserSettings = protectedProcedure
  .route({
    method: "GET",
    path: "/settings",
    tags: ["Settings"],
    summary: "Get the current user's settings",
  })
  .output(getUserSettingsOutputSchema)
  .handler(async ({ context }) => {
    const [row] = await db
      .select()
      .from(userSettings)
      .where(eq(userSettings.userId, context.user.id));

    return {
      success: true as const,
      reason: "Settings fetched",
      settings: row
        ? {
            userId: row.userId,
            aiModelOverride: row.aiModelOverride,
            pollIntervalDefaultMinutes: row.pollIntervalDefaultMinutes,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
          }
        : {
            userId: context.user.id,
            aiModelOverride: null,
            pollIntervalDefaultMinutes: null,
            createdAt: null,
            updatedAt: null,
          },
    };
  });
