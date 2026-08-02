import { and, asc, eq } from "drizzle-orm";
import { ORPCError } from "@orpc/server";
import { db } from "@iris/database";
import { priceReadings, products } from "@iris/database/drizzle/schema/postgres";
import { protectedProcedure } from "../../../orpc/procedures";
import { toNumber } from "../../shared";
import { byProductInputSchema, byProductOutputSchema } from "../types";

/**
 * Compact price-reading series for a product's chart (ordered by `checkedAt`
 * asc — a change-point series since readings are only inserted on change, R9).
 * Ownership is verified before any data is returned.
 */
export const byProductHistory = protectedProcedure
  .route({
    method: "GET",
    path: "/history/{id}",
    tags: ["History"],
    summary: "Get the price history series for a product",
  })
  .input(byProductInputSchema)
  .output(byProductOutputSchema)
  .handler(async ({ input, context }) => {
    const { id, limit } = input;

    const [product] = await db
      .select()
      .from(products)
      .where(and(eq(products.id, id), eq(products.userId, context.user.id)));

    if (!product) {
      throw new ORPCError("NOT_FOUND", { message: "Product not found" });
    }

    const readings = await db
      .select()
      .from(priceReadings)
      .where(eq(priceReadings.productId, id))
      .orderBy(asc(priceReadings.checkedAt), asc(priceReadings.id))
      .limit(limit);

    return {
      success: true as const,
      reason: "History fetched",
      productId: product.id,
      currency: product.currency,
      readings: readings.map((reading) => ({
        checkedAt: reading.checkedAt,
        price: toNumber(reading.price),
        currency: reading.currency,
      })),
    };
  });
