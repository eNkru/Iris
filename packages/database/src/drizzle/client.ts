import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { getEnv } from "@iris/utils";
import * as schema from "./schema";

/**
 * SQLite database + Drizzle instance.
 *
 * The full schema map is registered on the instance so better-auth's Drizzle
 * adapter can resolve its tables (`user`, `session`, `account`, `verification`)
 * without an explicit mapping. SQLite is configured for WAL concurrency and
 * foreign-key enforcement because both are part of the application contract.
 */
const databasePath = getEnv().DATABASE_PATH;
if (databasePath !== ":memory:") {
  mkdirSync(path.dirname(path.resolve(databasePath)), { recursive: true });
}

const sqlite = new Database(databasePath);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

export const db = drizzle(sqlite, { schema });

export type Database = typeof db;
