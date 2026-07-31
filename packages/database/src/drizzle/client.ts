import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { getEnv } from "@iris/utils";
import * as schema from "./schema";

/**
 * PostgreSQL pool + Drizzle instance.
 *
 * The full schema map is registered on the instance so better-auth's Drizzle
 * adapter can resolve its tables (`user`, `session`, `account`, `verification`)
 * without an explicit mapping.
 *
 * Lazy connection: `new Pool()` does not connect until the first query, so
 * importing this module is safe during builds and when Postgres is down.
 */
const pool = new Pool({ connectionString: getEnv().DATABASE_URL });

export const db = drizzle(pool, { schema });

export type Database = typeof db;
