/**
 * Node.js-only instrumentation side effects.
 *
 * This module is only ever loaded from instrumentation.ts behind a
 * `process.env.NEXT_RUNTIME === 'nodejs'` guard. It imports the scheduler,
 * whose dependencies (pg, ioredis, drizzle) are Node-only and must never be
 * bundled into the edge runtime compilation.
 */
import { startScheduler, stopScheduler } from "@iris/prices";
import { logger } from "@iris/utils";

export function start(): void {
  try {
    startScheduler({
      onError: (error: unknown) => {
        logger.error("Scheduler tick error", {
          error: error instanceof Error ? error.message : String(error),
        });
      },
    });
  } catch (error) {
    // The app must still boot if the scheduler can't start (e.g. Redis down);
    // the loop logs per-tick failures rather than taking the process down.
    logger.error("Failed to start scheduler", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export function stop(): void {
  stopScheduler();
}
