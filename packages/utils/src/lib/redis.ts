import { Redis } from "ioredis";
import { logger } from "./logger";
import { getEnv } from "./env";

/**
 * Shared Redis client (session cache, scheduler distributed lock).
 *
 * `lazyConnect` keeps connection attempts deferred until the first command, so
 * importing this module is safe when Redis is down; callers must treat cache
 * failures as non-fatal (cache-aside falls back to the database).
 */
let redisClient: Redis | null = null;

export function getRedis(): Redis {
  if (!redisClient) {
    redisClient = new Redis(getEnv().REDIS_URL, {
      lazyConnect: true,
      maxRetriesPerRequest: 2,
    });
    redisClient.on("error", (error: Error) => {
      logger.error("Redis connection error", { error: error.message });
    });
  }
  return redisClient;
}

export function closeRedis(): void {
  if (redisClient) {
    void redisClient.quit();
    redisClient = null;
  }
}
