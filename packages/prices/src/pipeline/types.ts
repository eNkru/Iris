import { z } from "zod";

/**
 * Structured output schema for AI price extraction (design.md pipeline step 2,
 * R5). `available: false` means the product is out of stock or no price is
 * visible on the page.
 *
 * Discriminated on `available`: when the model reports the product as
 * available, `price`/`currency` are required; when unavailable, they may be
 * null/absent (the model often returns `null` for fields it could not find).
 * The pipeline never reads `price`/`currency` in the unavailable branch, so
 * this lets an `available: false` response validate instead of failing on
 * `price: null`.
 */
export const priceExtractionSchema = z.discriminatedUnion("available", [
  z.object({
    available: z.literal(true),
    price: z.number().positive(),
    currency: z.string().min(1).max(16),
    name: z.string().min(1).optional(),
  }),
  z.object({
    available: z.literal(false),
    price: z.number().positive().nullable().optional(),
    currency: z.string().min(1).max(16).nullable().optional(),
    name: z.string().min(1).nullable().optional(),
  }),
]);

export type PriceExtraction = z.infer<typeof priceExtractionSchema>;

/**
 * Result of one `checkPrice(productId)` run (design.md pipeline step 3).
 *
 * - `changed`: a new `price_readings` row was inserted and `currentPrice`
 *   updated; `oldPrice` is null on the very first successful check.
 * - `unchanged`: price did not move; only `lastCheckedAt` was updated (R9).
 * - `unavailable`: the page loaded but the AI reported the product as
 *   out of stock / price not visible.
 * - `failed`: page fetch or AI extraction failed; `lastCheckedAt` was still
 *   updated so the product is not re-checked on the next scheduler tick.
 * - `not_found`: no product row with this id.
 */
export type CheckPriceResult =
  | {
      status: "changed";
      oldPrice: number | null;
      newPrice: number;
      currency: string;
      alertDispatched: boolean;
    }
  | { status: "unchanged"; price: number }
  | { status: "unavailable" }
  | { status: "failed"; reason: string }
  | { status: "not_found" };
