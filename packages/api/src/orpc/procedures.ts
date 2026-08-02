import { ORPCError, os } from "@orpc/server";
import { getSessionWithCache } from "@iris/auth/lib/session-cache";
import { logIdMiddleware } from "./middleware/log-id-middleware";

/**
 * Public procedure — no authentication required. Every procedure starts from
 * here so it always has `{ headers, logId }` in context.
 */
export const publicProcedure = os
  .$context<{ headers: Headers }>()
  .use(logIdMiddleware);

/**
 * Protected procedure — requires a valid session (authentication.md).
 * Injects `session` and `user` into the context for downstream handlers.
 */
export const protectedProcedure = publicProcedure.use(
  async ({ context, next }) => {
    const result = await getSessionWithCache(context.headers);

    if (!result.session) {
      throw new ORPCError("UNAUTHORIZED", {
        message: "Please sign in to continue",
      });
    }

    return await next({
      context: {
        session: result.session.session,
        user: result.session.user,
      },
    });
  },
);

/**
 * Admin procedure — requires the `admin` role (R2, R6).
 */
export const adminProcedure = protectedProcedure.use(
  async ({ context, next }) => {
    if (context.user.role !== "admin") {
      throw new ORPCError("FORBIDDEN", {
        message: "Admin access required",
      });
    }

    return await next();
  },
);
