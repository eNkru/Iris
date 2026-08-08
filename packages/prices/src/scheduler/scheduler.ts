import { and, eq, gt, sql } from "drizzle-orm";
import pLimit from "p-limit";
import { db } from "@iris/database";
import { products } from "@iris/database/drizzle/schema/sqlite";
import { getGlobalSettings } from "@iris/database/drizzle/queries";
import { getEnv, logger } from "@iris/utils";
import { checkPrice } from "../pipeline/check-price";

type ProductRow = typeof products.$inferSelect;

/**
 * In-process scheduler loop (design.md "Scheduler", R14 — web + scheduler in
 * one container).
 *
 * Every `tickMs` the loop:
 * 1. Queries due products in one batch query: `active = true` AND
 *    `lastCheckedAt` older than the product's interval (per-product override
 *    falling back to the global default) — no N+1 (database.md).
 * 3. Processes each batch with bounded `p-limit` concurrency calling
 *    `checkPrice`, then releases the lock.
 *
 * Duplicate checks for one product are prevented by checkPrice's in-process
 * single-flight mutex, which covers scheduler and manual RPC races.
 */

const DEFAULT_BATCH_SIZE = 50;
const DEFAULT_CONCURRENCY = 5;
const DEFAULT_INTERVAL_MINUTES = 60;

export interface SchedulerOptions {
  /** Loop period (default: env `SCHEDULER_TICK_MS`). */
  tickMs?: number;
  /** How many due products to load per batch query (default 50). */
  batchSize?: number;
  /** Max concurrent `checkPrice` calls (default 5). */
  concurrency?: number;
  /** Invoked when a tick throws (default: logged). */
  onError?: (error: unknown) => void;
}

let tickTimer: ReturnType<typeof setInterval> | null = null;
let tickInProgress = false;

/**
 * Start the scheduler loop. Safe to call once; subsequent calls are no-ops.
 */
export function startScheduler(options: SchedulerOptions = {}): void {
  if (tickTimer !== null) {
    logger.warn("Scheduler already started; ignoring duplicate start");
    return;
  }

  const tickMs = options.tickMs ?? getEnv().SCHEDULER_TICK_MS;
  tickTimer = setInterval(() => {
    void runSchedulerTick(options).catch((error: unknown) => {
      logger.error("Scheduler tick failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      options.onError?.(error);
    });
  }, tickMs);

  logger.info("Scheduler started", {
    tickMs,
    batchSize: options.batchSize ?? DEFAULT_BATCH_SIZE,
    concurrency: options.concurrency ?? DEFAULT_CONCURRENCY,
  });
}

/**
 * Stop the scheduler loop (tests, graceful shutdown).
 */
export function stopScheduler(): void {
  if (tickTimer !== null) {
    clearInterval(tickTimer);
    tickTimer = null;
    logger.info("Scheduler stopped");
  }
}

/**
 * Run one scheduler tick. Exported for tests and manual triggering.
 */
export async function runSchedulerTick(options: SchedulerOptions = {}): Promise<void> {
  if (tickInProgress) {
    logger.debug("Scheduler tick skipped: previous tick still running");
    return;
  }

  tickInProgress = true;

  try {
    const settings = await getGlobalSettings();
    const defaultIntervalMinutes =
      settings?.pollIntervalDefaultMinutes ?? DEFAULT_INTERVAL_MINUTES;

    const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
    const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;
    const limiter = pLimit(concurrency);

    let processed = 0;
    let cursorId: string | undefined;
    let hasMore = true;

    while (hasMore) {
      const batch = await findDueProducts({ batchSize, defaultIntervalMinutes, cursorId });
      if (batch.length === 0) {
        break;
      }

      const results = await Promise.allSettled(
        batch.map((product) => limiter(() => checkPrice(product.id))),
      );

      processed += results.filter((result) => result.status === "fulfilled").length;

      for (const result of results) {
        if (result.status === "rejected") {
          logger.error("Scheduler checkPrice failed", {
            error: result.reason instanceof Error ? result.reason.message : String(result.reason),
          });
        }
      }

      const lastProduct = batch[batch.length - 1];
      cursorId = lastProduct?.id;
      hasMore = batch.length === batchSize;
    }

    logger.info("Scheduler tick complete", {
      processed,
      defaultIntervalMinutes,
      batchSize,
      concurrency,
    });
  } finally {
    tickInProgress = false;
  }
}

interface FindDueProductsParams {
  batchSize: number;
  defaultIntervalMinutes: number;
  cursorId?: string;
}

/**
 * Batch query for due products (database.md — single query, keyset cursor):
 * `active = true` AND (`lastCheckedAt` is null OR `lastCheckedAt` is older than
 * `COALESCE(pollIntervalMinutes, global default)` minutes). The interval
 * resolution happens in SQL so per-product overrides need no extra queries.
 */
async function findDueProducts(
  params: FindDueProductsParams,
): Promise<ProductRow[]> {
  const { batchSize, defaultIntervalMinutes, cursorId } = params;

  return db
    .select()
    .from(products)
    .where(
      and(
        eq(products.active, true),
        sql`(${products.lastCheckedAt} IS NULL OR ${products.lastCheckedAt} < unixepoch() - COALESCE(${products.pollIntervalMinutes}, ${defaultIntervalMinutes}) * 60)`,
        cursorId !== undefined ? gt(products.id, cursorId) : undefined,
      ),
    )
    .orderBy(products.id)
    .limit(batchSize);
}
