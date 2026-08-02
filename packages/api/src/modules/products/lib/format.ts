import { priceReadings, products } from "@iris/database/drizzle/schema/postgres";
import { toNullableNumber, toNumber } from "../../shared";
import type { PriceReadingOutput, ProductOutput } from "../types";

type ProductRow = typeof products.$inferSelect;
type ReadingRow = typeof priceReadings.$inferSelect;

/**
 * Map a `products` DB row to the API output shape. Drizzle returns `numeric`
 * columns as strings, so prices are normalized to `number` here (the output
 * schemas declare `z.number()`, not `z.coerce.number()`, to keep the contract
 * explicit).
 */
export function toProductOutput(row: ProductRow): ProductOutput {
  return {
    id: row.id,
    userId: row.userId,
    url: row.url,
    name: row.name,
    currency: row.currency,
    currentPrice: toNullableNumber(row.currentPrice),
    lastCheckedAt: row.lastCheckedAt,
    pollIntervalMinutes: row.pollIntervalMinutes,
    alertRules: row.alertRules,
    active: row.active,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Map a `price_readings` DB row to the API output shape.
 */
export function toPriceReadingOutput(row: ReadingRow): PriceReadingOutput {
  return {
    id: row.id,
    productId: row.productId,
    price: toNumber(row.price),
    currency: row.currency,
    checkedAt: row.checkedAt,
  };
}
