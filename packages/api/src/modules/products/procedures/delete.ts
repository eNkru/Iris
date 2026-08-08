import { and, eq } from "drizzle-orm";
import { ORPCError } from "@orpc/server";
import { db } from "@iris/database";
import { products } from "@iris/database/drizzle/schema/sqlite";
import { protectedProcedure } from "../../../orpc/procedures";
import { deleteProductOutputSchema, productIdInputSchema } from "../types";

/**
 * Delete a product. `price_readings` rows cascade via the FK
 * (`onDelete: "cascade"`), so no manual cleanup is needed.
 */
export const deleteProduct = protectedProcedure
  .route({
    method: "DELETE",
    path: "/products/{id}",
    tags: ["Products"],
    summary: "Delete a product and its price history",
  })
  .input(productIdInputSchema)
  .output(deleteProductOutputSchema)
  .handler(async ({ input, context }) => {
    const { id } = input;

    const [existing] = await db
      .select()
      .from(products)
      .where(and(eq(products.id, id), eq(products.userId, context.user.id)));

    if (!existing) {
      throw new ORPCError("NOT_FOUND", { message: "Product not found" });
    }

    await db.delete(products).where(eq(products.id, id));

    return {
      success: true as const,
      reason: "Product deleted",
    };
  });
