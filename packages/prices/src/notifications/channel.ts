import type { ChannelType } from "@iris/utils";
import type { PriceAlertNotification } from "./format";

/**
 * Notification channel interface + registry (design.md, R11).
 *
 * Channels are an additive registry: a new channel type = a new enum value in
 * `@iris/utils` + an adapter registered here. The `email` adapter can be added
 * later without schema/API changes (R12).
 */
export interface NotificationChannel {
  channelType: ChannelType;
  /**
   * Deliver a price alert to this channel using the per-channel config stored
   * in `alert_channels.config` (e.g. `{ chatId }` for telegram). Implementations
   * must never throw — failures are logged and the pipeline continues.
   */
  send(notification: PriceAlertNotification, config: Record<string, unknown>): Promise<void>;
}

const registry = new Map<ChannelType, NotificationChannel>();

export function registerChannel(channel: NotificationChannel): void {
  registry.set(channel.channelType, channel);
}

export function getChannel(channelType: ChannelType): NotificationChannel | undefined {
  return registry.get(channelType);
}
