import pLimit from "p-limit";
import { getEnv, logger } from "@iris/utils";
import { getGlobalSettings } from "@iris/database/drizzle/queries";
import type { NotificationChannel } from "./channel";
import { formatPriceAlertMessage, type PriceAlertNotification } from "./format";

/**
 * Telegram Bot API adapter — plain HTTP `sendMessage`, no SDK dependency
 * (design.md notification channel interface, R11/R12).
 *
 * The bot token is read from `global_settings.telegramBotToken`
 * (admin-managed, masked on read), falling back to the `TELEGRAM_BOT_TOKEN`
 * env var for local development. Failures are logged and swallowed so a
 * notification problem never crashes the price-check pipeline.
 */

const TELEGRAM_CONCURRENCY = 5;
const TELEGRAM_TIMEOUT_MS = 10_000;
const TELEGRAM_API_BASE_URL = "https://api.telegram.org";

const telegramLimiter = pLimit(TELEGRAM_CONCURRENCY);

export const telegramChannel: NotificationChannel = {
  channelType: "telegram",

  async send(notification: PriceAlertNotification, config: Record<string, unknown>): Promise<void> {
    const chatId = config.chatId;
    if (typeof chatId !== "string" || chatId.trim() === "") {
      logger.warn("Telegram channel config missing chatId; skipping alert", {
        productId: notification.productId,
      });
      return;
    }

    const settings = await getGlobalSettings();
    const botToken = settings?.telegramBotToken ?? getEnv().TELEGRAM_BOT_TOKEN;
    if (botToken === "") {
      logger.warn("Telegram bot token not configured; skipping alert", {
        productId: notification.productId,
      });
      return;
    }

    const text = formatPriceAlertMessage(notification);

    try {
      await telegramLimiter(async () => {
        const response = await fetch(`${TELEGRAM_API_BASE_URL}/bot${botToken}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: chatId,
            text,
            disable_web_page_preview: true,
          }),
          signal: AbortSignal.timeout(TELEGRAM_TIMEOUT_MS),
        });

        if (!response.ok) {
          const body = await response.text().catch(() => "");
          throw new Error(`Telegram API responded ${response.status}: ${body.slice(0, 200)}`);
        }
      });

      logger.info("Telegram price alert sent", {
        productId: notification.productId,
        chatId,
        direction: notification.direction,
      });
    } catch (error) {
      logger.error("Telegram price alert failed", {
        productId: notification.productId,
        chatId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },
};
