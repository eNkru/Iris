import "./env";

import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { RPCHandler } from "@orpc/server/fetch";
import { getSessionCookie } from "better-auth/cookies";
import { Hono } from "hono";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { stat } from "node:fs/promises";
import { auth } from "@iris/auth";
import { getProductImageForUser } from "@iris/database";
import { router } from "@iris/api/orpc/router";
import { startScheduler, stopScheduler } from "@iris/prices";
import { getEnv, logger } from "@iris/utils";

/**
 * Resolve the server directory. In CJS (esbuild production bundle),
 * `__dirname` is available natively. In ESM (tsx dev), `import.meta.url`
 * is used instead. esbuild's CJS output leaves `import.meta.url` as
 * `undefined`, so the conditional is required.
 */
const serverDir =
  typeof __dirname !== "undefined"
    ? __dirname
    : dirname(fileURLToPath(import.meta.url));

const distRoot = join(serverDir, "..", "dist");

const app = new Hono();

/**
 * oRPC RPCHandler — mirrors the contract in the former Next route handler
 * (`app/api/rpc/[...path]/route.ts`). The router is mounted under `/api/rpc`;
 * the handler strips that prefix before matching, and seeds the context with
 * the request headers so `protectedProcedure` can resolve the session cookie.
 */
const rpcHandler = new RPCHandler(router);

app.on(["GET", "POST"], "/api/rpc/*", async (c) => {
  const { matched, response } = await rpcHandler.handle(c.req.raw, {
    prefix: "/api/rpc",
    context: { headers: c.req.raw.headers },
  });

  if (!matched) {
    return c.body("Not found", 404);
  }

  return response;
});

/**
 * better-auth handler (magic-link sign-in/verify, session, sign-out).
 * `auth.handler` is a framework-agnostic fetch handler — replaces the former
 * `toNextJsHandler(auth)` in `app/api/auth/[...all]/route.ts`.
 */
app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw));

/**
 * Product image serving. Verifies the session, checks that the product
 * belongs to the authenticated user, then streams the image file from
 * the local `IMAGES_DIR`. Returns 404 when the product has no image or
 * the file is missing on disk.
 */
app.get("/api/images/:id", async (c) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) {
    return c.body("Unauthorized", 401);
  }

  const productId = c.req.param("id");

  const product = await getProductImageForUser(productId, session.user.id);

  if (!product?.imagePath) {
    return c.body("Not found", 404);
  }

  const filePath = join(getEnv().IMAGES_DIR, product.imagePath);

  try {
    await stat(filePath);
  } catch {
    return c.body("Not found", 404);
  }

  const ext = product.imagePath.split(".").pop()?.toLowerCase() ?? "";
  const contentTypes: Record<string, string> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    webp: "image/webp",
    svg: "image/svg+xml",
  };
  const contentType = contentTypes[ext] ?? "application/octet-stream";

  const buffer = await readFile(filePath);
  return new Response(buffer, {
    headers: {
      "content-type": contentType,
      "cache-control": "private, max-age=86400",
    },
  });
});

/**
 * Vite-built static assets (JS/CSS chunks). Served without auth — they are
 * public, fingerprinted files with no sensitive content.
 */
app.use("/assets/*", serveStatic({ root: distRoot }));

/**
 * Root-level public files copied from `public/` into `dist/` (e.g. `/icon.svg`).
 * Served directly from disk so they are not swept up by the SPA fallback. The
 * `/`, `/api/*` and `/assets/*` paths are excluded: those must flow through the
 * auth gate / SPA fallback below (root serves `index.html` and would otherwise
 * bypass the auth gate).
 */
app.use("*", (c, next) => {
  if (c.req.path === "/" || c.req.path.startsWith("/api/") || c.req.path.startsWith("/assets/")) {
    return next();
  }
  return serveStatic({ root: distRoot })(c, next);
});

/**
 * Server-side auth gate (mirrors `middleware.ts`). For non-`/api`, non-asset
 * GET requests, check the session cookie presence:
 * - No cookie + not `/login` → redirect to `/login?redirectTo=…`
 * - Cookie + `/login` → redirect to `/` (already authenticated)
 *
 * This is a cookie-presence check only (not session validation); the client
 * `AuthGuard` and oRPC `protectedProcedure` enforce the real session.
 */
app.get("*", async (c, next) => {
  const path = c.req.path;

  // Skip the auth guard for API and asset routes (handled above).
  if (path.startsWith("/api/") || path.startsWith("/assets/")) {
    return next();
  }

  const sessionCookie = getSessionCookie(c.req.raw);

  if (!sessionCookie && path !== "/login") {
    const loginUrl = new URL("/login", c.req.url);
    loginUrl.searchParams.set("redirectTo", path);
    return c.redirect(loginUrl.toString(), 302);
  }

  if (sessionCookie && path === "/login") {
    return c.redirect(new URL("/", c.req.url).toString(), 302);
  }

  return next();
});

/**
 * SPA fallback: serve `index.html` for all remaining GET routes. React Router
 * handles client-side routing from there.
 */
app.get("*", serveStatic({ root: distRoot, path: "index.html" }));

/**
 * Start the in-process price-check scheduler on boot (mirrors
 * `instrumentation-node.ts`). Gated to production only — dev runs the scheduler
 * via the "Run checks" admin action to avoid duplicate ticks during HMR.
 *
 * Wrapped in try/catch so the app still boots if the scheduler can't start;
 * the loop logs per-tick failures rather than taking the process down.
 */
function startSchedulerSafely(): void {
  if (process.env.NODE_ENV !== "production") {
    return;
  }

  try {
    startScheduler({
      onError: (error: unknown) => {
        logger.error("Scheduler tick error", {
          error: error instanceof Error ? error.message : String(error),
        });
      },
    });
  } catch (error) {
    logger.error("Failed to start scheduler", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

const server = serve(
  { fetch: app.fetch, port: 3000 },
  () => {
    logger.info("Server started", { port: 3000 });
    startSchedulerSafely();
  },
);

/**
 * Graceful shutdown: stop the scheduler loop and close the HTTP server.
 * Mirrors the `onClose()` pattern from `instrumentation.ts`.
 */
function shutdown(): void {
  stopScheduler();
  server.close(() => {
    logger.info("Server stopped");
    process.exit(0);
  });
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
