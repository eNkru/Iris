import { eq } from "drizzle-orm";
import { countUsers, db } from "@iris/database";
import { user } from "@iris/database/drizzle/schema/auth";
import { logger } from "@iris/utils";

/**
 * R2 — the first user to sign in becomes admin.
 *
 * Called from better-auth's `user.create.after` database hook, i.e. right after
 * the user row is inserted. If this was the very first user in the table, they
 * are promoted to `admin`. Safe for a single-instance LAN deployment; a
 * cross-instance race here only downgrades the second concurrent sign-up.
 */
export async function bootstrapFirstUserAsAdmin(userId: string): Promise<void> {
  const userCount = await countUsers();

  if (userCount !== 1) {
    return;
  }

  await db.update(user).set({ role: "admin" }).where(eq(user.id, userId));

  logger.info("First user promoted to admin", { userId });
}
