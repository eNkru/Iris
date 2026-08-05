import type { PriceDirection } from "../pipeline/alert-rules";

/**
 * Payload dispatched to every enabled channel for a product's user.
 */
export interface PriceAlertNotification {
  productId: string;
  userId: string;
  productName: string | null;
  productUrl: string;
  currency: string | null;
  oldPrice: number;
  newPrice: number;
  direction: PriceDirection;
}

export function formatPrice(price: number, currency: string): string {
  const amount = price.toFixed(2);
  return currency === "" ? amount : `${currency} ${amount}`;
}

/**
 * Escape text for Telegram's HTML parse mode. Telegram only understands a
 * small tag subset (<b>, <i>, <a>, …); everything user-supplied must be
 * escaped so product names containing "&"/"<"/">" render literally instead of
 * breaking the message.
 */
export function escapeTelegramHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Price with thousands separators for readability in chat messages,
 * e.g. `formatPriceGrouped(1999, "USD")` → `"USD 1,999.00"`.
 */
export function formatPriceGrouped(price: number, currency: string): string {
  const sign = price < 0 ? "-" : "";
  const fixed = Math.abs(price).toFixed(2); // always "NNN.NN"
  const dot = fixed.indexOf(".");
  const whole = fixed.slice(0, dot);
  const decimals = fixed.slice(dot + 1);
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const amount = `${sign}${grouped}.${decimals}`;
  return currency === "" ? amount : `${currency} ${amount}`;
}

/**
 * Clickable Telegram HTML link. The href is attribute-escaped (including
 * quotes) and the label text-escaped.
 */
export function formatTelegramLink(url: string, label: string): string {
  const href = escapeTelegramHtml(url).replace(/"/g, "&quot;");
  return `<a href="${href}">${escapeTelegramHtml(label)}</a>`;
}

/**
 * Telegram HTML message for a price alert (parse_mode "HTML"). Bold product
 * name, grouped prices, and a clickable "View product" link instead of a raw
 * URL.
 */
export function formatPriceAlertMessage(notification: PriceAlertNotification): string {
  const name = escapeTelegramHtml(notification.productName ?? "Tracked product");
  const directionLabel =
    notification.direction === "rise" ? "📈 <b>Price increase</b>" : "📉 <b>Price drop</b>";

  const currency = notification.currency ?? "";
  const oldLine = formatPriceGrouped(notification.oldPrice, currency);
  const newLine = formatPriceGrouped(notification.newPrice, currency);

  const pct =
    notification.oldPrice > 0
      ? `${notification.direction === "rise" ? "+" : "-"}${Math.abs(
          ((notification.newPrice - notification.oldPrice) / notification.oldPrice) * 100,
        ).toFixed(1)}%`
      : null;

  return [
    directionLabel,
    name,
    `💰 ${oldLine} → ${newLine}${pct !== null ? ` (${pct})` : ""}`,
    `🔗 ${formatTelegramLink(notification.productUrl, "View product")}`,
  ].join("\n");
}
