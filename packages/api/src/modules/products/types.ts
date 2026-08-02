import { z } from "zod";
import { alertRulesSchema } from "@iris/utils";
import { okResultSchema } from "../shared";

/**
 * Products module schemas (design.md "API Surface" — `products.*`).
 * Zod-first types (shared/typescript.md); inputs are validated by oRPC.
 */

// --- Input schemas ---

/**
 * URL must parse and be http(s) only. `new URL` accepts more schemes (mailto:,
 * javascript:) which must never reach the page fetcher (R4).
 */
export const httpUrlSchema = z
  .string()
  .refine(
    (value) => {
      try {
        const parsed = new URL(value);
        return parsed.protocol === "http:" || parsed.protocol === "https:";
      } catch {
        return false;
      }
    },
    { message: "Must be a valid http(s) URL" },
  );

export const createProductInputSchema = z.object({
  url: httpUrlSchema,
  /** Per-product interval override in minutes; null/absent = global default (R7). */
  pollIntervalMinutes: z.number().int().min(1).max(10080).optional(),
  /** Alert threshold rules (R10); null/absent = default alert on any change. */
  alertRules: alertRulesSchema.optional(),
});
export type CreateProductInput = z.infer<typeof createProductInputSchema>;

export const listProductsInputSchema = z.object({
  active: z.boolean().optional(),
  limit: z.number().int().min(1).max(100).default(50),
});
export type ListProductsInput = z.infer<typeof listProductsInputSchema>;

export const productIdInputSchema = z.object({
  id: z.string().uuid(),
});
export type ProductIdInput = z.infer<typeof productIdInputSchema>;

export const getProductInputSchema = z.object({
  id: z.string().uuid(),
  /** Max number of history readings to return (change-point series is compact). */
  limit: z.number().int().min(1).max(10_000).default(1_000),
});
export type GetProductInput = z.infer<typeof getProductInputSchema>;

export const updateProductInputSchema = z.object({
  id: z.string().uuid(),
  pollIntervalMinutes: z.number().int().min(1).max(10080).nullable().optional(),
  alertRules: alertRulesSchema.optional(),
  active: z.boolean().optional(),
});
export type UpdateProductInput = z.infer<typeof updateProductInputSchema>;

export const checkNowInputSchema = z.object({
  id: z.string().uuid(),
});
export type CheckNowInput = z.infer<typeof checkNowInputSchema>;

// --- Output schemas ---

export const priceReadingOutputSchema = z.object({
  id: z.string(),
  productId: z.string(),
  price: z.number(),
  currency: z.string().nullable(),
  checkedAt: z.date(),
});
export type PriceReadingOutput = z.infer<typeof priceReadingOutputSchema>;

export const productOutputSchema = z.object({
  id: z.string(),
  userId: z.string(),
  url: z.string(),
  name: z.string().nullable(),
  currency: z.string().nullable(),
  currentPrice: z.number().nullable(),
  lastCheckedAt: z.date().nullable(),
  pollIntervalMinutes: z.number().int().nullable(),
  alertRules: alertRulesSchema,
  active: z.boolean(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type ProductOutput = z.infer<typeof productOutputSchema>;

/** List item = product + its latest stored reading (may be null before any change). */
export const productListItemOutputSchema = productOutputSchema.extend({
  latestReading: priceReadingOutputSchema.nullable(),
});
export type ProductListItemOutput = z.infer<typeof productListItemOutputSchema>;

/**
 * Result of one `checkPrice` run (mirrors `@iris/prices` `CheckPriceResult`,
 * design.md pipeline step 3).
 */
export const checkPriceResultSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("changed"),
    oldPrice: z.number().nullable(),
    newPrice: z.number(),
    currency: z.string(),
    alertDispatched: z.boolean(),
  }),
  z.object({
    status: z.literal("unchanged"),
    price: z.number(),
  }),
  z.object({
    status: z.literal("unavailable"),
  }),
  z.object({
    status: z.literal("failed"),
    reason: z.string(),
  }),
  z.object({
    status: z.literal("not_found"),
  }),
]);
export type CheckPriceResultOutput = z.infer<typeof checkPriceResultSchema>;

export const createProductOutputSchema = z.object({
  success: z.literal(true),
  reason: z.string(),
  product: productOutputSchema,
  check: checkPriceResultSchema,
});
export type CreateProductOutput = z.infer<typeof createProductOutputSchema>;

export const listProductsOutputSchema = z.object({
  success: z.literal(true),
  reason: z.string(),
  products: z.array(productListItemOutputSchema),
});
export type ListProductsOutput = z.infer<typeof listProductsOutputSchema>;

export const getProductOutputSchema = z.object({
  success: z.literal(true),
  reason: z.string(),
  product: productOutputSchema,
  history: z.array(priceReadingOutputSchema),
});
export type GetProductOutput = z.infer<typeof getProductOutputSchema>;

export const updateProductOutputSchema = z.object({
  success: z.literal(true),
  reason: z.string(),
  product: productOutputSchema,
});
export type UpdateProductOutput = z.infer<typeof updateProductOutputSchema>;

export const deleteProductOutputSchema = okResultSchema;
export type DeleteProductOutput = z.infer<typeof deleteProductOutputSchema>;

export const checkNowOutputSchema = z.object({
  success: z.literal(true),
  reason: z.string(),
  check: checkPriceResultSchema,
});
export type CheckNowOutput = z.infer<typeof checkNowOutputSchema>;
