import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import type { AiModelOverride, AlertRules, ChannelType } from "@iris/utils";
import { CHANNEL_TYPE_VALUES } from "@iris/utils";
import { user } from "./auth";

const timestamp = (name: string) =>
  integer(name, { mode: "timestamp" }).default(sql`(unixepoch())`);

const id = (name: string) =>
  text(name).primaryKey().$defaultFn(() => randomUUID());

/**
 * SQLite application schema. The historical module name is retained as a
 * compatibility export for workspace consumers; the storage dialect is SQLite.
 */
export const products = sqliteTable(
  "products",
  {
    id: id("id"),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    name: text("name"),
    currency: text("currency"),
    currentPrice: text("currentPrice"),
    lastCheckedAt: integer("lastCheckedAt", { mode: "timestamp" }),
    pollIntervalMinutes: integer("pollIntervalMinutes"),
    alertRules: text("alertRules", { mode: "json" }).$type<AlertRules>(),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    createdAt: timestamp("createdAt").notNull(),
    updatedAt: timestamp("updatedAt").notNull(),
  },
  (table) => [
    index("products_user_id_idx").on(table.userId),
    index("products_last_checked_at_idx").on(table.lastCheckedAt),
  ],
);

export const priceReadings = sqliteTable(
  "price_readings",
  {
    id: id("id"),
    productId: text("productId")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    price: text("price").notNull(),
    currency: text("currency"),
    checkedAt: timestamp("checkedAt").notNull(),
  },
  (table) => [
    index("price_readings_product_id_checked_at_idx").on(table.productId, table.checkedAt),
  ],
);

export const alertChannels = sqliteTable(
  "alert_channels",
  {
    id: id("id"),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    channelType: text("channelType").$type<ChannelType>().notNull(),
    config: text("config", { mode: "json" }).notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    createdAt: timestamp("createdAt").notNull(),
    updatedAt: timestamp("updatedAt").notNull(),
  },
  (table) => [
    check(
      "alert_channels_channel_type_check",
      sql`${table.channelType} IN (${sql.raw(
        CHANNEL_TYPE_VALUES.map((value) => `'${value}'`).join(", "),
      )})`,
    ),
    uniqueIndex("alert_channels_user_id_channel_type_uq").on(table.userId, table.channelType),
    index("alert_channels_user_id_idx").on(table.userId),
  ],
);

export const userSettings = sqliteTable("user_settings", {
  userId: text("userId")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  aiModelOverride: text("aiModelOverride", { mode: "json" }).$type<AiModelOverride>(),
  pollIntervalDefaultMinutes: integer("pollIntervalDefaultMinutes"),
  createdAt: timestamp("createdAt").notNull(),
  updatedAt: timestamp("updatedAt").notNull(),
});

export const globalSettings = sqliteTable("global_settings", {
  id: integer("id").primaryKey(),
  aiBaseUrl: text("aiBaseUrl").notNull().default("https://api.openai.com/v1"),
  aiApiKey: text("aiApiKey").notNull().default(""),
  aiModel: text("aiModel").notNull().default("gpt-4o-mini"),
  pollIntervalDefaultMinutes: integer("pollIntervalDefaultMinutes").notNull().default(60),
  telegramBotToken: text("telegramBotToken"),
  aiZenHost: text("aiZenHost").notNull().default("opencode.ai"),
  aiUserAgent: text("aiUserAgent").notNull().default("opencode/1.18.12 ai-sdk/provider-utils/4.0.23 runtime/bun/1.3.13"),
  aiClientHeader: text("aiClientHeader").notNull().default("cli"),
  createdAt: timestamp("createdAt").notNull(),
  updatedAt: timestamp("updatedAt").notNull(),
});

