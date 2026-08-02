import { and, eq, gt, sql } from "drizzle-orm";
import pLimit from "p-limit";
import { db } from "@iris/database";
import { products } from "@iris/database/drizzle/schema/postgres";
import { getGlobalSettings } from "@iris/database/drizzle/queries";
import { getEnv, getRedis, logger } from "@iris/utils";
import { checkPrice } from "../pipeline/check-price";

type ProductRow = typeof products.$inferSelect;

/**
 * In-process scheduler loop (design.md "Scheduler", R14 — web + scheduler in
 * one container).
 *
 * Every `tickMs` the loop:
 * 1. Acquires a Redis distributed lock (`prices:scheduler:lock`, NX + TTL) so
 *    concurrent app replicas don't double-process the same products
 *    (performance.md — Background Tasks with Distributed Locks).
 * 2. Queries due products in one batch query: `active = true` AND
 *    `lastCheckedAt` older than the product's interval (per-product override
 *    falling back to the global default) — no N+1 (database.md).
 * 3. Processes each batch with bounded `p-limit` concurrency calling
 *    `checkPrice`, then releases the lock.
 *
 * A duplicate reading is additionally prevented at the database layer:
 * `checkPrice` re-reads the product row with `SELECT ... FOR UPDATE`, so even
 * if the lock TTL expires mid-tick and a second replica picks the same
 * products, the writes serialize safely.
 */

const LOCK_KEY = "prices:scheduler:lock";
const DEFAULT_BATCH_SIZE = 50;
const DEFAULT_CONCURRENCY = 5;
const DEFAULT_INTERVAL_MINUTES = 60;

export interface SchedulerOptions {
  /** Loop period (default: env `SCHEDULER_TICK_MS`). */
  tickMs?: number;
  /** Redis lock TTL in seconds (default: env `SCHEDULER_LOCK_TTL_SECONDS`). */
  lockTtlSeconds?: number;
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
  const lockTtlSeconds = options.lockTtlSeconds ?? getEnv().SCHEDULER_LOCK_TTL_SECONDS;

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
    lockTtlSeconds,
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

  const redis = getRedis();
  const lockTtlSeconds = options.lockTtlSeconds ?? getEnv().SCHEDULER_LOCK_TTL_SECONDS;
  const lockToken = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  let lockAcquired = false;

  try {
    const acquired = await redis.set(LOCK_KEY, lockToken, "EX", lockTtlSeconds, "NX");
    if (acquired !== "OK") {
      logger.debug("Scheduler lock not acquired; another instance is processing", {
        lockKey: LOCK_KEY,
      });
      return;
    }
    lockAcquired = true;

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
    if (lockAcquired) {
      try {
        // Release only if we still own the lock (compare-and-delete).
        const releaseScript =
          "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";
        await redis.eval(releaseScript, 1, LOCK_KEY, lockToken);
      } catch (error) {
        logger.warn("Failed to release scheduler lock", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
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
        sql`(${products.lastCheckedAt} IS NULL OR ${products.lastCheckedAt} < now() - make_interval(mins => COALESCE(${products.pollIntervalMinutes}, ${defaultIntervalMinutes})))`,
        cursorId !== undefined ? gt(products.id, cursorId) : undefined,
      ),
    )
    .orderBy(products.id)
    .limit(batchSize);
}
