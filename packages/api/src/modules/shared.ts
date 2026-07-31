import { z } from "zod";

/**
 * Standard "operation result" output shape (shared/typescript.md — every API
 * output includes `success` and `reason`). `success` is a literal `true` so
 * data-returning procedures stay consistent with the standard response format.
 */
export const okResultSchema = z.object({
  success: z.literal(true),
  reason: z.string(),
});

export type OkResult = z.infer<typeof okResultSchema>;

/**
 * Convert a nullable DB `numeric` value (returned by node-postgres as a string)
 * to `number | null`. `numeric` never stores NaN/Infinity, so `Number()` is
 * safe here.
 */
export function toNullableNumber(value: string | null): number | null {
  return value === null ? null : Number(value);
}

/**
 * Convert a DB `numeric` value (returned as a string) to `number`.
 */
export function toNumber(value: string): number {
  return Number(value);
}

/**
 * Convert an arbitrary DB JSONB value into the `Record<string, unknown>` the
 * output schemas and channel adapters expect. Malformed configs degrade to an
 * empty record (no blind type assertions — shared/typescript.md).
 */
export function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}
