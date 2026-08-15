import { and, eq } from "drizzle-orm";
import { db } from "../client";
import { products } from "../schema/sqlite";

/**
 * Get a product's image path and owner, scoped by product ID and user ID.
 * Used by the image-serving route to verify ownership before streaming the
 * file from disk.
 */
export async function getProductImageForUser(
  productId: string,
  userId: string,
): Promise<{ imagePath: string | null; userId: string } | null> {
  const [row] = await db
    .select({ imagePath: products.imagePath, userId: products.userId })
    .from(products)
    .where(and(eq(products.id, productId), eq(products.userId, userId)));

  return row ?? null;
}
