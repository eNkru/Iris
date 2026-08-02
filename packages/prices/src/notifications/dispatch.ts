import { and, eq } from "drizzle-orm";
import { db } from "@iris/database";
import { alertChannels } from "@iris/database/drizzle/schema/postgres";
import { logger } from "@iris/utils";
import { getChannel, registerChannel } from "./channel";
import { telegramChannel } from "./telegram";
import type { PriceAlertNotification } from "./format";

let defaultChannelsRegistered = false;

/**
 * Register the built-in notification channels (idempotent). Called lazily by
 * `dispatchPriceAlert` so the pipeline works without explicit app wiring; the
 * app may also call it at boot for clarity.
 */
export function registerDefaultChannels(): void {
  if (defaultChannelsRegistered) {
    return;
  }
  registerChannel(telegramChannel);
  defaultChannelsRegistered = true;
}

export interface DispatchResult {
  sent: number;
  total: number;
}

/**
 * Convert an arbitrary DB JSONB value into the `Record<string, unknown>` the
 * channel adapters expect. Malformed configs degrade to an empty record and
 * the adapter logs a helpful warning (no type assertions without validation).
 */
function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

/**
 * Dispatch a price alert to every enabled channel belonging to the product's
 * user (R11). Sends are fire-and-forget: failures are logged, never thrown.
 * Returns how many channels were notified.
 */
export async function dispatchPriceAlert(
  notification: PriceAlertNotification,
): Promise<DispatchResult> {
  registerDefaultChannels();

  const channels = await db
    .select()
    .from(alertChannels)
    .where(
      and(
        eq(alertChannels.userId, notification.userId),
        eq(alertChannels.enabled, true),
      ),
    );

  if (channels.length === 0) {
    logger.debug("No enabled alert channels for user; skipping dispatch", {
      userId: notification.userId,
      productId: notification.productId,
    });
    return { sent: 0, total: 0 };
  }

  const results = await Promise.allSettled(
    channels.map((channel) => {
      const adapter = getChannel(channel.channelType);
      if (!adapter) {
        logger.warn("No notification adapter registered for channel type", {
          channelType: channel.channelType,
          userId: notification.userId,
          productId: notification.productId,
        });
        return Promise.resolve();
      }
      return adapter.send(notification, asRecord(channel.config));
    }),
  );

  const sent = results.filter((result) => result.status === "fulfilled").length;

  for (const result of results) {
    if (result.status === "rejected") {
      logger.error("Price alert dispatch failed", {
        userId: notification.userId,
        productId: notification.productId,
        error:
          result.reason instanceof Error ? result.reason.message : String(result.reason),
      });
    }
  }

  logger.info("Price alert dispatch complete", {
    productId: notification.productId,
    userId: notification.userId,
    sent,
    total: channels.length,
  });

  return { sent, total: channels.length };
}
