import { and, eq } from "drizzle-orm";
import { ORPCError } from "@orpc/server";
import { db } from "@iris/database";
import { products } from "@iris/database/drizzle/schema/postgres";
import { protectedProcedure } from "../../../orpc/procedures";
import { toProductOutput } from "../lib/format";
import { updateProductInputSchema, updateProductOutputSchema } from "../types";

/**
 * Update a product: per-product poll interval (R7), alert rules (R10), and the
 * active/paused toggle. Ownership is verified before any write.
 */
export const updateProduct = protectedProcedure
  .route({
    method: "PATCH",
    path: "/products/{id}",
    tags: ["Products"],
    summary: "Update poll interval, alert rules, or tracking state",
  })
  .input(updateProductInputSchema)
  .output(updateProductOutputSchema)
  .handler(async ({ input, context }) => {
    const { id, pollIntervalMinutes, alertRules, active } = input;

    const [existing] = await db
      .select()
      .from(products)
      .where(and(eq(products.id, id), eq(products.userId, context.user.id)));

    if (!existing) {
      throw new ORPCError("NOT_FOUND", { message: "Product not found" });
    }

    const set: Partial<typeof products.$inferSelect> = { updatedAt: new Date() };
    if (pollIntervalMinutes !== undefined) {
      set.pollIntervalMinutes = pollIntervalMinutes;
    }
    if (alertRules !== undefined) {
      set.alertRules = alertRules;
    }
    if (active !== undefined) {
      set.active = active;
    }

    const [updated] = await db
      .update(products)
      .set(set)
      .where(eq(products.id, id))
      .returning();

    if (!updated) {
      throw new ORPCError("INTERNAL_SERVER_ERROR", {
        message: "Failed to update the product",
      });
    }

    return {
      success: true as const,
      reason: "Product updated",
      product: toProductOutput(updated),
    };
  });
