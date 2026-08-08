import { config as loadDotenv } from "dotenv";
import path from "node:path";
import { defineConfig } from "drizzle-kit";

// drizzle-kit runs from packages/database; load the repo-root `.env` so
// DATABASE_PATH is available to `migrate`/`studio` (generate is offline).
loadDotenv({ path: path.resolve(process.cwd(), "../../.env") });

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/drizzle/schema/index.ts",
  out: "./drizzle/migrations",
  dbCredentials: {
    url: process.env.DATABASE_PATH ?? "./data/iris.db",
  },
  strict: true,
  verbose: true,
});
