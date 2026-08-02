import { eq } from "drizzle-orm";
import { ORPCError } from "@orpc/server";
import { db } from "@iris/database";
import { products } from "@iris/database/drizzle/schema/postgres";
import { checkPrice } from "@iris/prices/pipeline";
import { logger } from "@iris/utils";
import { protectedProcedure } from "../../../orpc/procedures";
import { toProductOutput } from "../lib/format";
import {
  createProductInputSchema,
  createProductOutputSchema,
} from "../types";

/**
 * Add a product by URL (R4) and run the FIRST synchronous price check
 * (design.md "sync first-check" trade-off — the create returns the current
 * price immediately, trading a longer request for immediate feedback).
 *
 * If the first check cannot return a price (fetch/AI failure, product
 * unavailable), the product row is rolled back and the create fails with
 * `INTERNAL_SERVER_ERROR` — the user never sees a broken tracked product.
 */
export const createProduct = protectedProcedure
  .route({
    method: "POST",
    path: "/products",
    tags: ["Products"],
    summary: "Add a product by URL and run the first price check",
  })
  .input(createProductInputSchema)
  .output(createProductOutputSchema)
  .handler(async ({ input, context }) => {
    const { url, pollIntervalMinutes, alertRules } = input;

    const [created] = await db
      .insert(products)
      .values({
        userId: context.user.id,
        url,
        pollIntervalMinutes: pollIntervalMinutes ?? null,
        alertRules: alertRules ?? null,
      })
      .returning();

    if (!created) {
      throw new ORPCError("INTERNAL_SERVER_ERROR", {
        message: "Failed to create the product",
      });
    }

    const check = await checkPrice(created.id);

    if (
      check.status === "failed" ||
      check.status === "unavailable" ||
      check.status === "not_found"
    ) {
      // Roll back the product row so the list never shows a product without a
      // first price reading.
      await db.delete(products).where(eq(products.id, created.id));

      const reason =
        check.status === "failed"
          ? `Could not read a price from the page: ${check.reason}. The product was not added.`
          : "Could not read a price from the page (unavailable or no visible price). The product was not added.";

      logger.warn("Product create rolled back after failed first check", {
        productId: created.id,
        userId: context.user.id,
        status: check.status,
        url,
      });

      throw new ORPCError("INTERNAL_SERVER_ERROR", { message: reason });
    }

    const [fresh] = await db
      .select()
      .from(products)
      .where(eq(products.id, created.id));

    return {
      success: true as const,
      reason: "Product added and first price check completed",
      product: toProductOutput(fresh ?? created),
      check,
    };
  });
