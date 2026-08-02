import type { Session } from "better-auth";
import { getSessionCookie } from "better-auth/cookies";
import { getRedis, logger } from "@iris/utils";
import type { Session as AuthSession } from "../auth";
import { auth } from "../auth";

const SESSION_CACHE_PREFIX = "session";
const SESSION_CACHE_TTL = 60 * 60 * 24 * 7; // 7 days

export interface SessionWithUser {
  session: Session;
  /** Inferred user shape including the `role` additional field. */
  user: AuthSession["user"];
}

export interface GetSessionResult {
  session: SessionWithUser | null;
  fromCache: boolean;
}

/**
 * Extract the session token from an Authorization bearer header, falling back
 * to the better-auth session cookie (handles the `__Secure-` prefix too).
 */
export function getSessionTokenFromHeaders(headers: Headers): string | null {
  const authHeader = headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice("Bearer ".length);
  }
  return getSessionCookie(headers);
}

/**
 * Cache-aside session lookup (authentication.md):
 * 1. Try Redis by session token.
 * 2. On miss (or cache failure), ask better-auth (DB) and repopulate the cache.
 *
 * Cache failures are non-fatal — the request falls back to the authoritative
 * database lookup so a Redis outage never breaks authentication.
 */
export async function getSessionWithCache(headers: Headers): Promise<GetSessionResult> {
  const token = getSessionTokenFromHeaders(headers);

  if (!token) {
    const session = await auth.api.getSession({ headers });
    return { session, fromCache: false };
  }

  const cacheKey = `${SESSION_CACHE_PREFIX}:${token}`;

  try {
    const cached = await getRedis().get(cacheKey);
    if (cached) {
      return { session: JSON.parse(cached) as SessionWithUser, fromCache: true };
    }
  } catch (error) {
    logger.warn("Session cache read failed, falling back to database", {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  const session = await auth.api.getSession({ headers });

  if (session) {
    try {
      await getRedis().set(cacheKey, JSON.stringify(session), "EX", SESSION_CACHE_TTL);
    } catch (error) {
      logger.warn("Session cache write failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { session, fromCache: false };
}

export async function invalidateSessionCache(token: string): Promise<void> {
  try {
    await getRedis().del(`${SESSION_CACHE_PREFIX}:${token}`);
  } catch (error) {
    logger.warn("Session cache delete failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
