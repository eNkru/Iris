import { count, eq } from "drizzle-orm";
import { db } from "../client";
import { user } from "../schema/auth";

/**
 * Count all users. Used by the first-user-becomes-admin bootstrap (R2).
 */
export async function countUsers(): Promise<number> {
  const [row] = await db.select({ count: count() }).from(user);
  return row?.count ?? 0;
}

/**
 * Fetch a user by id.
 */
export async function getUserById(id: string) {
  const [row] = await db.select().from(user).where(eq(user.id, id));
  return row ?? null;
}
