import { and, eq } from "drizzle-orm";
import { unlinkSync } from "node:fs";
import path from "node:path";
import { ORPCError } from "@orpc/server";
import { db } from "@iris/database";
import { products } from "@iris/database/drizzle/schema/sqlite";
import { getEnv, logger } from "@iris/utils";
import { protectedProcedure } from "../../../orpc/procedures";
import { deleteProductOutputSchema, productIdInputSchema } from "../types";

/**
 * Delete a product. `price_readings` rows cascade via the FK
 * (`onDelete: "cascade"`), so no manual cleanup is needed. If the product had
 * a downloaded image, the local file is also removed.
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

    if (existing.imagePath) {
      try {
        const filePath = path.join(getEnv().IMAGES_DIR, existing.imagePath);
        unlinkSync(filePath);
      } catch (error) {
        logger.warn("Failed to delete product image file", {
          productId: id,
          imagePath: existing.imagePath,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return {
      success: true as const,
      reason: "Product deleted",
    };
  });
