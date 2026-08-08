import { alertChannels } from "@iris/database/drizzle/schema/sqlite";
import { asRecord } from "../../shared";
import type { ChannelOutput } from "../types";

type ChannelRow = typeof alertChannels.$inferSelect;

/**
 * Map an `alert_channels` DB row to the API output shape. `config` is a JSONB
 * column typed `unknown` by Drizzle; `asRecord` keeps the output contract as a
 * plain object without blind type assertions.
 */
export function toChannelOutput(row: ChannelRow): ChannelOutput {
  return {
    id: row.id,
    userId: row.userId,
    channelType: row.channelType,
    config: asRecord(row.config),
    enabled: row.enabled,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
