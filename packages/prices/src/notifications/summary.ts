import { and, eq } from "drizzle-orm";
import { db } from "@iris/database";
import { alertChannels, products } from "@iris/database/drizzle/schema/sqlite";
import { logger, type Language } from "@iris/utils";
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
export function formatRelativeTime(date: Date | null, lang: Language = "en"): string {
  if (date === null) {
    return lang === "zh" ? "从未" : "never";
  }
  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) {
    return lang === "zh" ? "刚刚" : "just now";
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return lang === "zh" ? `${minutes}分钟前` : `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return lang === "zh" ? `${hours}小时前` : `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  if (days < 7) {
    return lang === "zh" ? `${days}天前` : `${days}d ago`;
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
 * Localized prose for the summary message. Emoji markers (`📦`, `💰`, `✅`,
 * `⏸️`) stay identical across languages; the surrounding text is translated.
 * `{n}`, `{a}`, `{p}`, `{time}` are placeholders formatted by the caller.
 */
const summaryText: Record<
  Language,
  {
    header: string;
    empty: string;
    count: string;
    active: string;
    paused: string;
    checked: string;
    noPrice: string;
  }
> = {
  en: {
    header: "📦 <b>Product summary</b>",
    empty: "No products tracked yet. Add a product URL to start.",
    count: "{n} tracked · {a} active · {p} paused",
    active: "✅ Active",
    paused: "⏸️ Paused",
    checked: "checked {time}",
    noPrice: "💰 No price recorded",
  },
  zh: {
    header: "📦 <b>商品摘要</b>",
    empty: "暂无追踪商品。添加商品链接即可开始。",
    count: "{n} 个商品 · {a} 个活跃 · {p} 个暂停",
    active: "✅ 活跃",
    paused: "⏸️ 暂停",
    checked: "检查于 {time}",
    noPrice: "💰 暂无价格记录",
  },
};

/**
 * Build a Telegram summary message from the user's tracked products
 * (parse_mode "HTML"): bold clickable product names, grouped prices, emoji
 * status markers, and one card per product. `lang` selects the localized
 * prose; price/URL formatting stays language-agnostic.
 */
export function formatProductSummaryMessage(
  items: ProductSummarySource[],
  lang: Language = "en",
): string {
  const activeCount = items.filter((item) => item.active).length;
  const pausedCount = items.length - activeCount;
  const txt = summaryText[lang];

  if (items.length === 0) {
    return [txt.header, txt.empty].join("\n\n");
  }

  const header = [txt.header, txt.count.replace("{n}", String(items.length)).replace("{a}", String(activeCount)).replace("{p}", String(pausedCount))].join("\n");

  const cards = items.map((item, index) => {
    const number = NUMBER_EMOJIS[index] ?? `${index + 1}.`;
    const name = formatTelegramLink(item.url, item.name ?? item.url);
    const price =
      item.currentPrice != null
        ? `💰 ${formatPriceGrouped(item.currentPrice, item.currency ?? "")}`
        : txt.noPrice;
    const status = item.active ? txt.active : txt.paused;
    return [
      number,
      name,
      price,
      `${status} · ${txt.checked.replace("{time}", formatRelativeTime(item.lastCheckedAt, lang))}`,
    ].join("\n");
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
  const items = rows.map((row) => ({
    name: row.name,
    url: row.url,
    currency: row.currency,
    currentPrice: row.currentPrice === null ? null : Number(row.currentPrice),
    lastCheckedAt: row.lastCheckedAt,
    active: row.active,
  }));

  // Group enabled channels by their notification language so one message is
  // built per distinct language and shared by all channels in that group
  // (≤2 messages per user). Missing/invalid language defaults to English.
  const textByLanguage = new Map<Language, string>();
  for (const channel of channels) {
    const config = (channel.config as Record<string, unknown> | null) ?? {};
    const lang: Language = config.language === "zh" ? "zh" : "en";
    if (!textByLanguage.has(lang)) {
      logger.debug("Building product summary message", { language: lang, productsCount });
      textByLanguage.set(lang, formatProductSummaryMessage(items, lang));
    }
  }

  const results = await Promise.all(
    channels.map(async (channel) => {
      const config = (channel.config as Record<string, unknown> | null) ?? {};
      const chatId = config.chatId;
      if (typeof chatId === "string" && chatId.trim() !== "") {
        const lang: Language = config.language === "zh" ? "zh" : "en";
        const text = textByLanguage.get(lang) ?? formatProductSummaryMessage(items, lang);
        await sendTelegramText(chatId, text, { userId, productsCount, language: lang });
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