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

function formatPrice(price: number, currency: string): string {
  const amount = price.toFixed(2);
  return currency === "" ? amount : `${currency} ${amount}`;
}

/**
 * Human-readable Telegram message for a price alert.
 */
export function formatPriceAlertMessage(notification: PriceAlertNotification): string {
  const name = notification.productName ?? "Tracked product";
  const directionLabel =
    notification.direction === "rise" ? "📈 Price increase" : "📉 Price drop";

  const oldLine = formatPrice(notification.oldPrice, notification.currency ?? "");
  const newLine = formatPrice(notification.newPrice, notification.currency ?? "");

  const pct =
    notification.oldPrice > 0
      ? `${notification.direction === "rise" ? "+" : "-"}${Math.abs(
          ((notification.newPrice - notification.oldPrice) / notification.oldPrice) * 100,
        ).toFixed(1)}%`
      : null;

  return [
    `${directionLabel}: ${name}`,
    `${oldLine} → ${newLine}${pct !== null ? ` (${pct})` : ""}`,
    notification.productUrl,
  ].join("\n");
}
