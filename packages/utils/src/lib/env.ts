import { z } from "zod";

/**
 * Environment variables validated with Zod.
 *
 * Loaded lazily so importing this module never fails at build time when the
 * shell lacks the full environment; `getEnv()` throws only when a required
 * variable is actually missing at first use.
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: z.string().url().default("http://localhost:3000"),

  // Database — a local SQLite file (the parent directory is created on startup).
  DATABASE_PATH: z.string().min(1, "DATABASE_PATH is required").default("./data/iris.db"),

  // SMTP — magic-link login emails (and future email alert channel)
  SMTP_HOST: z.string().default("localhost"),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_USER: z.string().default(""),
  SMTP_PASS: z.string().default(""),
  SMTP_FROM: z.string().min(1).default("noreply@localhost"),

  // better-auth session signing secret. MUST be replaced in production.
  BETTER_AUTH_SECRET: z.string().min(1).default("dev-secret-change-me"),

  // AI config — generic OpenAI-compatible endpoint. These are build-time
  // fallbacks; instance-level config (base URL, API key, model) is admin-editable
  // and stored in `global_settings`. The pipeline resolves DB → env fallback.
  AI_BASE_URL: z.string().url().default("https://api.openai.com/v1"),
  AI_API_KEY: z.string().default(""),
  AI_MODEL: z.string().default("gpt-4o-mini"),
  AI_EXTRACT_CONCURRENCY: z.coerce.number().int().positive().default(1),
  AI_EXTRACT_MIN_INTERVAL_MS: z.coerce.number().int().nonnegative().default(2_000),

  // AI client identification headers — sent only when the base URL hostname
  // matches AI_ZEN_HOST. Lets the admin update the User-Agent / client header
  // when OpenCode Zen bumps versions or changes its identification scheme,
  // without a code change. Stored in `global_settings` (admin-editable); these
  // env vars are the boot-time fallback (DB → env).
  AI_ZEN_HOST: z.string().default("opencode.ai"),
  AI_USER_AGENT: z.string().default(
    "opencode/1.18.12 ai-sdk/provider-utils/4.0.23 runtime/bun/1.3.13",
  ),
  AI_CLIENT_HEADER: z.string().default("cli"),

  // Telegram alert channel
  TELEGRAM_BOT_TOKEN: z.string().default(""),

  // Scheduler — in-process loop tick
  SCHEDULER_TICK_MS: z.coerce.number().int().positive().default(30_000),

  // Camoufox sidecar — the single fetch transport (design.md §Config).
  // The sidecar runs the anti-detect Firefox browser that fetches product
  // pages behind hard anti-bot challenges (DataDome / Cloudflare / Akamai).
  // It is a required dependency in every environment (dev and prod): a missing
  // value is a hard config error at first use, matching `DATABASE_PATH`.
  CAMOUFOX_SIDECAR_URL: z.string().url("CAMOUFOX_SIDECAR_URL is required"),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Parse a raw environment object (defaults to `process.env`) against the
 * schema. Exposed for tests and for packages that need a scoped subset.
 */
export function loadEnv(schema: z.ZodType<Env> = envSchema): Env {
  return schema.parse(process.env);
}

let cachedEnv: Env | undefined;

/**
 * Lazily validated environment singleton. Use everywhere server-side instead
 * of touching `process.env` directly.
 */
export function getEnv(): Env {
  if (!cachedEnv) {
    cachedEnv = loadEnv();
  }
  return cachedEnv;
}

export function resetEnvCache(): void {
  cachedEnv = undefined;
}
