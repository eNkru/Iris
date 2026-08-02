import "./env";
import { logger } from "@iris/utils";
import { upsertGlobalSettings } from "./drizzle/queries/settings";

/**
 * Seed the `global_settings` singleton row (id = 1).
 *
 * Usage: `pnpm db:seed` (after `pnpm db:migrate`).
 */
async function main(): Promise<void> {
  const row = await upsertGlobalSettings({
    aiProvider: "openai",
    aiModel: "gpt-4o-mini",
    pollIntervalDefaultMinutes: 60,
  });

  logger.info("Seeded global_settings singleton row", {
    id: row?.id ?? null,
  });
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    logger.error("Failed to seed global_settings", {
      error: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  });
