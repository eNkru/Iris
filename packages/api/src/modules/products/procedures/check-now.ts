import { and, eq } from "drizzle-orm";
import { ORPCError } from "@orpc/server";
import { db } from "@iris/database";
import { products } from "@iris/database/drizzle/schema/sqlite";
import { checkPrice } from "@iris/prices/pipeline";
import { protectedProcedure } from "../../../orpc/procedures";
import { checkNowInputSchema, checkNowOutputSchema } from "../types";

/**
 * Manual synchronous re-check of a product (R8 — same pipeline the scheduler
 * uses). Returns the check result so the UI can reflect a fresh price.
 */
export const checkProductNow = protectedProcedure
  .route({
    method: "POST",
    path: "/products/{id}/check-now",
    tags: ["Products"],
    summary: "Run a price check for a product now",
  })
  .input(checkNowInputSchema)
  .output(checkNowOutputSchema)
  .handler(async ({ input, context }) => {
    const { id } = input;

    const [existing] = await db
      .select()
      .from(products)
      .where(and(eq(products.id, id), eq(products.userId, context.user.id)));

    if (!existing) {
      throw new ORPCError("NOT_FOUND", { message: "Product not found" });
    }

    const check = await checkPrice(id);

    if (check.status === "not_found") {
      throw new ORPCError("NOT_FOUND", { message: "Product not found" });
    }

    return {
      success: true as const,
      reason: "Price check completed",
      check,
    };
  });
