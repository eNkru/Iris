import { eq } from "drizzle-orm";
import { db } from "../client";
import { globalSettings } from "../schema/sqlite";
import type { GlobalSettingsInput, GlobalSettingsRow } from "./types";

export const GLOBAL_SETTINGS_ID = 1;

/**
 * Read the singleton global settings row. Returns null before `db:seed` runs.
 */
export async function getGlobalSettings(): Promise<GlobalSettingsRow | null> {
  const [row] = await db
    .select()
    .from(globalSettings)
    .where(eq(globalSettings.id, GLOBAL_SETTINGS_ID));
  return row ?? null;
}

/**
 * Insert or update the singleton global settings row (id = 1). Idempotent.
 */
export async function upsertGlobalSettings(
  settings: GlobalSettingsInput,
): Promise<GlobalSettingsRow | null> {
  const [row] = await db
    .insert(globalSettings)
    .values({ id: GLOBAL_SETTINGS_ID, ...settings })
    .onConflictDoUpdate({
      target: globalSettings.id,
      set: {
        ...settings,
        updatedAt: new Date(),
      },
    })
    .returning();

  return row ?? null;
}
