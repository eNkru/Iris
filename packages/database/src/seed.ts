import "./env";
import { logger } from "@iris/utils";
import { upsertGlobalSettings } from "./drizzle/queries/settings";

/**
 * Seed the `global_settings` singleton row (id = 1). AI config values come from
 * the environment (with the same defaults as the env schema) so first-boot
 * matches the build-time config; the admin can override them at runtime.
 *
 * Usage: `pnpm db:seed` (after `pnpm db:migrate`).
 */
async function main(): Promise<void> {
  const row = await upsertGlobalSettings({
    aiBaseUrl: process.env.AI_BASE_URL ?? "https://api.openai.com/v1",
    aiApiKey: process.env.AI_API_KEY ?? "",
    aiModel: process.env.AI_MODEL ?? "gpt-4o-mini",
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
