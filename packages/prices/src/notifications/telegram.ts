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

/**
 * Resolve the Telegram bot token from global settings, falling back to the
 * `TELEGRAM_BOT_TOKEN` env var for local development.
 */
async function resolveBotToken(): Promise<string> {
  const settings = await getGlobalSettings();
  return settings?.telegramBotToken ?? getEnv().TELEGRAM_BOT_TOKEN;
}

/**
 * Strip Telegram HTML tags for the plain-text fallback send. Tags in
 * `format.ts` output are always well-formed `<b>`/`<a href="...">` wrappers,
 * so a tag-removal regex is sufficient — entity escaping is harmless in a
 * fallback (rare) path.
 */
function stripHtmlTags(html: string): string {
  return html.replace(/<[^>]+>/g, "");
}

/**
 * Low-level Telegram `sendMessage` with `parse_mode: "HTML"` (all message
 * formatters in `notifications/` produce escaped Telegram HTML). Resolves the
 * bot token, sends the text to `chatId`, and never throws — failures are
 * logged and swallowed so a notification problem never crashes the caller
 * (price-check pipeline or summary delivery). If Telegram rejects the markup
 * (HTTP 400), retries once as plain text so the user still gets the content.
 * `meta` carries structured context for logging.
 */
export async function sendTelegramText(
  chatId: string,
  text: string,
  meta: Record<string, unknown> = {},
): Promise<void> {
  if (chatId.trim() === "") {
    logger.warn("Telegram chatId is empty; skipping message", meta);
    return;
  }

  const botToken = await resolveBotToken();
  if (botToken === "") {
    logger.warn("Telegram bot token not configured; skipping message", meta);
    return;
  }

  const post = async (parseMode: "HTML" | undefined): Promise<void> => {
    const response = await fetch(`${TELEGRAM_API_BASE_URL}/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: parseMode === "HTML" ? text : stripHtmlTags(text),
        parse_mode: parseMode,
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(TELEGRAM_TIMEOUT_MS),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      const error = new Error(`Telegram API responded ${response.status}: ${body.slice(0, 200)}`);
      (error as Error & { status?: number }).status = response.status;
      throw error;
    }
  };

  try {
    await telegramLimiter(async () => {
      try {
        await post("HTML");
      } catch (error) {
        if ((error as Error & { status?: number }).status === 400) {
          logger.warn("Telegram rejected HTML markup; retrying as plain text", {
            chatId,
            error: error instanceof Error ? error.message : String(error),
            ...meta,
          });
          await post(undefined);
          return;
        }
        throw error;
      }
    });

    logger.info("Telegram message sent", { chatId, ...meta });
  } catch (error) {
    logger.error("Telegram message failed", {
      chatId,
      error: error instanceof Error ? error.message : String(error),
      ...meta,
    });
  }
}

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

    const text = formatPriceAlertMessage(notification);

    await sendTelegramText(chatId, text, {
      productId: notification.productId,
      direction: notification.direction,
    });
  },
};
