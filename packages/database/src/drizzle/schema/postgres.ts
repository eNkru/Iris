import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { AiModelOverride, AlertRules } from "@iris/utils";
import { CHANNEL_TYPE_VALUES } from "@iris/utils";
import { user } from "./auth";

/**
 * Enum types. Values come from @iris/utils (single source of truth); app code
 * imports the Zod schemas / types from utils, never from this package.
 */
export const channelTypeEnum = pgEnum("channel_type", CHANNEL_TYPE_VALUES);

/**
 * Tracked products (R4).
 */
export const products = pgTable(
  "products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // better-auth user IDs are 32-char alphanumeric strings (user.id is text),
    // so the FK column must be text too — uuid would fail at migrate time.
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    // Filled from the first successful AI visit; improved on later visits.
    name: text("name"),
    currency: text("currency"),
    currentPrice: numeric("currentPrice", { precision: 14, scale: 2 }),
    // Drives scheduler due-ness (R7): due when lastCheckedAt < now - interval.
    lastCheckedAt: timestamp("lastCheckedAt", { withTimezone: true }),
    // Per-product interval override; null = global default (R7).
    pollIntervalMinutes: integer("pollIntervalMinutes"),
    // Alert thresholds (R10).
    alertRules: jsonb("alertRules").$type<AlertRules>(),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("createdAt", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updatedAt", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("products_user_id_idx").on(table.userId),
    index("products_last_checked_at_idx").on(table.lastCheckedAt),
  ],
);

/**
 * Price readings — inserted only on price change (R9). The trend chart reads
 * this table as a change-point series.
 */
export const priceReadings = pgTable(
  "price_readings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("productId")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    price: numeric("price", { precision: 14, scale: 2 }).notNull(),
    currency: text("currency"),
    checkedAt: timestamp("checkedAt", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("price_readings_product_id_checked_at_idx").on(table.productId, table.checkedAt),
  ],
);

/**
 * Notification channel registry (R11): `channel_type` enum + config JSONB.
 * `(userId, channelType)` is unique — one config per channel type per user.
 */
export const alertChannels = pgTable(
  "alert_channels",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    channelType: channelTypeEnum("channelType").notNull(),
    // e.g. `{ chatId: "123456789" }` for telegram
    config: jsonb("config").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("createdAt", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updatedAt", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("alert_channels_user_id_channel_type_uq").on(table.userId, table.channelType),
    index("alert_channels_user_id_idx").on(table.userId),
  ],
);

/**
 * Per-user settings (R6): reserved per-user AI model override + global default
 * interval override.
 */
export const userSettings = pgTable("user_settings", {
  userId: text("userId")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  aiModelOverride: jsonb("aiModelOverride").$type<AiModelOverride>(),
  pollIntervalDefaultMinutes: integer("pollIntervalDefaultMinutes"),
  createdAt: timestamp("createdAt", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updatedAt", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Instance-level global settings — singleton row (id = 1), seeded by `db:seed`.
 * Admin-managed (R6, R7). AI config is generic OpenAI-compatible: base URL +
 * API key + model. The API key is masked on read (never returned in full).
 */
export const globalSettings = pgTable("global_settings", {
  id: integer("id").primaryKey(),
  aiBaseUrl: text("aiBaseUrl").notNull().default("https://api.openai.com/v1"),
  aiApiKey: text("aiApiKey").notNull().default(""),
  aiModel: text("aiModel").notNull().default("gpt-4o-mini"),
  pollIntervalDefaultMinutes: integer("pollIntervalDefaultMinutes").notNull().default(60),
  telegramBotToken: text("telegramBotToken"),
  createdAt: timestamp("createdAt", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updatedAt", { withTimezone: true }).notNull().defaultNow(),
});
