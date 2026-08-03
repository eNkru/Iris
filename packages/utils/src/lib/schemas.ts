import { z } from "zod";

/**
 * Shared Zod schemas for the standard API response format.
 *
 * Every API output must include `success` and `reason` (shared/typescript.md).
 */

export const operationResultSchema = z.object({
  success: z.boolean(),
  reason: z.string(),
});
export type OperationResult = z.infer<typeof operationResultSchema>;

export const paginationSchema = z.object({
  limit: z.number().int().min(1).max(100).default(50),
});
export type Pagination = z.infer<typeof paginationSchema>;

export const batchOperationResultSchema = z.object({
  success: z.boolean(),
  reason: z.string(),
  total: z.number().int(),
  processed: z.number().int(),
  failed: z.number().int(),
  errors: z
    .array(
      z.object({
        itemId: z.string(),
        error: z.string(),
      }),
    )
    .optional(),
});
export type BatchOperationResult = z.infer<typeof batchOperationResultSchema>;

/**
 * Per-product alert rules stored in `products.alertRules` (jsonb).
 * Default behavior: alert on any change. Thresholds (rise/fall, percent and/or
 * absolute) can be configured separately (R10).
 */
export const alertRulesSchema = z
  .object({
    anyChange: z.boolean().optional(),
    risePct: z.number().positive().optional(),
    fallPct: z.number().positive().optional(),
    riseAbs: z.number().positive().optional(),
    fallAbs: z.number().positive().optional(),
  })
  .nullable();
export type AlertRules = z.infer<typeof alertRulesSchema>;

/**
 * Reserved per-user AI model override (R6). `null` = use global config.
 * Schema-ready for a later phase; not exposed in the MVP UI. Only the model is
 * overridable per user — base URL and API key are instance-level.
 */
export const aiModelOverrideSchema = z
  .object({
    model: z.string().min(1).optional(),
  })
  .nullable();
export type AiModelOverride = z.infer<typeof aiModelOverrideSchema>;
