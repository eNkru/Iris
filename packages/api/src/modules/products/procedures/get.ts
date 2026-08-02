import { and, asc, eq } from "drizzle-orm";
import { ORPCError } from "@orpc/server";
import { db } from "@iris/database";
import { priceReadings, products } from "@iris/database/drizzle/schema/postgres";
import { protectedProcedure } from "../../../orpc/procedures";
import { toPriceReadingOutput, toProductOutput } from "../lib/format";
import { getProductInputSchema, getProductOutputSchema } from "../types";

/**
 * Product detail: the product row + its full price history (change-point
 * series, ordered by `checkedAt` asc) for the trend chart.
 */
export const getProduct = protectedProcedure
  .route({
    method: "GET",
    path: "/products/{id}",
    tags: ["Products"],
    summary: "Get a product with its price history",
  })
  .input(getProductInputSchema)
  .output(getProductOutputSchema)
  .handler(async ({ input, context }) => {
    const { id, limit } = input;

    const [row] = await db
      .select()
      .from(products)
      .where(and(eq(products.id, id), eq(products.userId, context.user.id)));

    if (!row) {
      throw new ORPCError("NOT_FOUND", { message: "Product not found" });
    }

    const history = await db
      .select()
      .from(priceReadings)
      .where(eq(priceReadings.productId, id))
      .orderBy(asc(priceReadings.checkedAt), asc(priceReadings.id))
      .limit(limit);

    return {
      success: true as const,
      reason: "Product fetched",
      product: toProductOutput(row),
      history: history.map(toPriceReadingOutput),
    };
  });
