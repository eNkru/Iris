import { join } from "node:path";
import { config } from "dotenv";

/**
 * Load the repo-root `.env` for local dev. In Docker the env vars are set
 * directly via ENV directives / compose, so the missing-file case is a no-op.
 *
 * Imported BEFORE any `@iris/*` package in `server.ts`. ES/CJS module
 * evaluation is side-effecting, so this module's top-level `config()` runs
 * before the `@iris/*` modules that call `getEnv()` at load time (e.g.
 * `@iris/database` resolves `DATABASE_PATH` on import).
 */
config({ path: join(process.cwd(), "../../.env") });