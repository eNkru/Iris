import { z } from "zod";
import { AI_PROVIDER_VALUES } from "./enum-types";

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

  // Database
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),

  // Redis (session cache, scheduler lock)
  REDIS_URL: z.string().min(1).default("redis://localhost:6379"),

  // SMTP — magic-link login emails (and future email alert channel)
  SMTP_HOST: z.string().default("localhost"),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_USER: z.string().default(""),
  SMTP_PASS: z.string().default(""),
  SMTP_FROM: z.string().min(1).default("noreply@localhost"),

  // better-auth session signing secret. MUST be replaced in production.
  BETTER_AUTH_SECRET: z.string().min(1).default("dev-secret-change-me"),

  // AI provider defaults (runtime/instance config is admin-editable and stored
  // in `global_settings`; these are build-time fallbacks)
  AI_PROVIDER: z.enum(AI_PROVIDER_VALUES).default("openai"),
  AI_MODEL: z.string().default("gpt-4o-mini"),
  OPENAI_API_KEY: z.string().default(""),
  GOOGLE_GENERATIVE_AI_API_KEY: z.string().default(""),
  ANTHROPIC_API_KEY: z.string().default(""),
  // OpenCode Zen — OpenAI-compatible gateway (provider "opencode"). The base
  // URL is overridable so a different OpenAI-compatible endpoint can be used
  // without a rebuild.
  OPENCODE_API_KEY: z.string().default(""),
  OPENCODE_BASE_URL: z
    .string()
    .url()
    .default("https://opencode.ai/zen/v1"),

  // Telegram alert channel
  TELEGRAM_BOT_TOKEN: z.string().default(""),

  // Scheduler — in-process loop tick and distributed-lock TTL
  SCHEDULER_TICK_MS: z.coerce.number().int().positive().default(30_000),
  SCHEDULER_LOCK_TTL_SECONDS: z.coerce.number().int().positive().default(60),
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
