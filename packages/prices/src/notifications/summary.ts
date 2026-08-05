import { and, eq } from "drizzle-orm";
import { db } from "@iris/database";
import { alertChannels, products } from "@iris/database/drizzle/schema/postgres";
import { logger } from "@iris/utils";
import { formatPriceGrouped, formatTelegramLink } from "./format";
import { sendTelegramText } from "./telegram";

/**
 * Product summary delivery (design.md — "Send summary to Telegram").
 *
 * Builds a human-readable summary of a user's tracked products and sends it to
 * every enabled Telegram channel. Reuses the low-level `sendTelegramText`
 * sender so bot-token resolution and send semantics stay in one place.
 */

export interface ProductSummaryItem {
  id: string;
  url: string;
  name: string | null;
  currency: string | null;
  currentPrice: number | null;
  lastCheckedAt: Date | null;
  active: boolean;
}

export interface ProductSummaryResult {
  /** Enabled channels targeted for delivery (only telegram is registered). */
  total: number;
  /** Channels the summary was delivered to successfully. */
  sent: number;
  /** Number of products included in the summary. */
  productsCount: number;
}

/**
 * Relative time (e.g. "2h ago") for a nullable date. Server-side equivalent of
 * the client helper — date math only, kept here to avoid sharing client UI
 * code server-side.
 */
export function formatRelativeTime(date: Date | null): string {
  if (date === null) {
    return "never";
  }
  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) {
    return "just now";
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  if (days < 7) {
    return `${days}d ago`;
  }
  return date.toLocaleDateString();
}

/** Minimum fields a product needs to be summarized. */
interface ProductSummarySource {
  name: string | null;
  url: string;
  currency: string | null;
  currentPrice: number | null;
  lastCheckedAt: Date | null;
  active: boolean;
}

/** Keycap emojis for card numbering; beyond 10 we fall back to plain digits. */
const NUMBER_EMOJIS = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"];

/**
 * Build a Telegram summary message from the user's tracked products
 * (parse_mode "HTML"): bold clickable product names, grouped prices, emoji
 * status markers, and one card per product.
 */
export function formatProductSummaryMessage(items: ProductSummarySource[]): string {
  const activeCount = items.filter((item) => item.active).length;
  const pausedCount = items.length - activeCount;

  if (items.length === 0) {
    return [
      "📦 <b>Product summary</b>",
      "No products tracked yet. Add a product URL to start.",
    ].join("\n\n");
  }

  const header = [
    "📦 <b>Product summary</b>",
    `${items.length} tracked · ${activeCount} active · ${pausedCount} paused`,
  ].join("\n");

  const cards = items.map((item, index) => {
    const number = NUMBER_EMOJIS[index] ?? `${index + 1}.`;
    const name = formatTelegramLink(item.url, item.name ?? item.url);
    const price =
      item.currentPrice != null
        ? `💰 ${formatPriceGrouped(item.currentPrice, item.currency ?? "")}`
        : "💰 No price recorded";
    const status = item.active ? "✅ Active" : "⏸️ Paused";
    return [number, name, price, `${status} · checked ${formatRelativeTime(item.lastCheckedAt)}`].join(
      "\n",
    );
  });

  return [header, ...cards].join("\n\n");
}

/**
 * Send a summary of the user's products to every enabled telegram channel.
 * Sends are best-effort (never throw on Telegram failure), matching the
 * price-alert adapter contract. Returns how many channels were targeted/sent
 * and how many products were summarized.
 */
export async function sendProductSummary(userId: string): Promise<ProductSummaryResult> {
  const rows = await db
    .select({
      name: products.name,
      url: products.url,
      currency: products.currency,
      currentPrice: products.currentPrice,
      lastCheckedAt: products.lastCheckedAt,
      active: products.active,
    })
    .from(products)
    .where(eq(products.userId, userId))
    .orderBy(products.createdAt);

  const channels = await db
    .select()
    .from(alertChannels)
    .where(
      and(
        eq(alertChannels.userId, userId),
        eq(alertChannels.channelType, "telegram"),
        eq(alertChannels.enabled, true),
      ),
    );

  const productsCount = rows.length;
  const text = formatProductSummaryMessage(
    rows.map((row) => ({
      name: row.name,
      url: row.url,
      currency: row.currency,
      currentPrice: row.currentPrice === null ? null : Number(row.currentPrice),
      lastCheckedAt: row.lastCheckedAt,
      active: row.active,
    })),
  );

  const results = await Promise.all(
    channels.map(async (channel) => {
      const chatId = (channel.config as Record<string, unknown> | null)?.chatId;
      if (typeof chatId === "string" && chatId.trim() !== "") {
        await sendTelegramText(chatId, text, { userId, productsCount });
        return true;
      }
      logger.warn("Telegram channel missing chatId; skipped summary", {
        userId,
        channelId: channel.id,
      });
      return false;
    }),
  );
  const sent = results.filter(Boolean).length;

  logger.info("Product summary sent", { userId, sent, total: channels.length, productsCount });

  return { sent, total: channels.length, productsCount };
}