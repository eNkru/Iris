/**
 * Next.js instrumentation — runs once when the server starts
 * (auto-discovered in Next 15, no config flag needed).
 *
 * Starts the in-process price-check scheduler in production so the app
 * container is both web server AND worker (design.md R14 — single container).
 *
 * Notes:
 * - `register()` is compiled into BOTH the Node server and the edge runtime
 *   (middleware exists, so the edge compilation runs). Node-only scheduler
 *   code therefore lives in ./instrumentation-node and is loaded only inside
 *   the `NEXT_RUNTIME === 'nodejs'` branch: Next statically replaces that
 *   constant per compilation ('edge' vs 'nodejs'), so webpack drops the
 *   dead branch and never bundles Node-only database dependencies into the edge runtime.
 * - `register()` is not invoked during `next build` (NEXT_PHASE check), so the
 *   build-time DATABASE_PATH only satisfies module-level env validation in
 *   @iris/database, not to boot the scheduler.
 * - The scheduler is intentionally NOT started in development: `next dev`
 *   re-runs instrumentation per server spawn and would duplicate ticks; dev
 *   work is exercised through the "Run checks" admin action instead.
 */

export async function register(): Promise<void> {
  if (process.env.NEXT_PHASE === "phase-production-build") {
    return;
  }

  if (process.env.NODE_ENV === "production" && process.env.NEXT_RUNTIME === "nodejs") {
    const { start } = await import("./instrumentation-node");
    start();
  }
}

export async function onClose(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { stop } = await import("./instrumentation-node");
    stop();
  }
}
