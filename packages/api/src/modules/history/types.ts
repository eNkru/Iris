import { z } from "zod";

/**
 * Price history module (design.md `history.byProduct`) — the compact
 * change-point series used by the trend chart. Unlike `products.get` (full
 * reading records), this returns only the chart-relevant fields.
 */

export const historyReadingSchema = z.object({
  checkedAt: z.date(),
  price: z.number(),
  currency: z.string().nullable(),
});
export type HistoryReading = z.infer<typeof historyReadingSchema>;

export const byProductInputSchema = z.object({
  id: z.string().uuid(),
  limit: z.number().int().min(1).max(10_000).default(5_000),
});
export type ByProductInput = z.infer<typeof byProductInputSchema>;

export const byProductOutputSchema = z.object({
  success: z.literal(true),
  reason: z.string(),
  productId: z.string(),
  currency: z.string().nullable(),
  readings: z.array(historyReadingSchema),
});
export type ByProductOutput = z.infer<typeof byProductOutputSchema>;
