import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "@iris/database";
import { priceReadings, products } from "@iris/database/drizzle/schema/postgres";
import { protectedProcedure } from "../../../orpc/procedures";
import { toPriceReadingOutput, toProductOutput } from "../lib/format";
import {
  listProductsInputSchema,
  listProductsOutputSchema,
  type PriceReadingOutput,
} from "../types";

/**
 * List the current user's products with the current price and the latest
 * stored reading. Latest readings are fetched in ONE batch query and grouped in
 * memory — no N+1 (database.md).
 */
export const listProducts = protectedProcedure
  .route({
    method: "GET",
    path: "/products",
    tags: ["Products"],
    summary: "List the user's tracked products",
  })
  .input(listProductsInputSchema)
  .output(listProductsOutputSchema)
  .handler(async ({ input, context }) => {
    const { active, limit } = input;

    const rows = await db
      .select()
      .from(products)
      .where(
        and(
          eq(products.userId, context.user.id),
          active !== undefined ? eq(products.active, active) : undefined,
        ),
      )
      .orderBy(desc(products.createdAt), desc(products.id))
      .limit(limit);

    const latestReadings =
      rows.length > 0
        ? await getLatestReadingsByProduct(rows.map((row) => row.id))
        : new Map<string, PriceReadingOutput>();

    return {
      success: true as const,
      reason: "Products fetched",
      products: rows.map((row) => ({
        ...toProductOutput(row),
        latestReading: latestReadings.get(row.id) ?? null,
      })),
    };
  });

/**
 * One batch query for the latest reading of every product (readings are ordered
 * ascending by insert, so the row with the max `checkedAt` per product wins).
 */
async function getLatestReadingsByProduct(
  productIds: string[],
): Promise<Map<string, PriceReadingOutput>> {
  const readings = await db
    .select()
    .from(priceReadings)
    .where(inArray(priceReadings.productId, productIds))
    .orderBy(asc(priceReadings.checkedAt), asc(priceReadings.id));

  const latestByProduct = new Map<string, PriceReadingOutput>();
  for (const reading of readings) {
    const existing = latestByProduct.get(reading.productId);
    const mapped = toPriceReadingOutput(reading);
    if (!existing || mapped.checkedAt.getTime() > existing.checkedAt.getTime()) {
      latestByProduct.set(reading.productId, mapped);
    }
  }
  return latestByProduct;
}
