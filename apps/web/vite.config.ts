import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

/**
 * Vite SPA build config (design.md §Architecture).
 *
 * - `react()` plugin transforms TSX.
 * - `resolve.alias` maps the `@iris/*` workspace packages to their TypeScript
 *   sources. Subpath entries (e.g. `@iris/auth/client`) are listed before the
 *   package root so the prefix matcher resolves the more specific path first.
 *   Vite transforms the `.ts` sources natively.
 * - `server.proxy` forwards `/api` to the dev Hono server on :3001 so the
 *   single `pnpm dev` command runs Vite + tsx concurrently.
 * - `build.outDir` is `dist`, served by the Hono production server.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      // Auth: client subpath must come before the root to avoid the
      // shorter prefix swallowing the subpath import.
      {
        find: "@iris/auth/client",
        replacement: resolve(__dirname, "../../packages/auth/src/client.ts"),
      },
      {
        find: "@iris/auth",
        replacement: resolve(__dirname, "../../packages/auth/src/index.ts"),
      },
      {
        find: "@iris/api/orpc/router",
        replacement: resolve(__dirname, "../../packages/api/src/orpc/router.ts"),
      },
      {
        find: "@iris/api/orpc/procedures",
        replacement: resolve(__dirname, "../../packages/api/src/orpc/procedures.ts"),
      },
      {
        find: "@iris/api",
        replacement: resolve(__dirname, "../../packages/api/src/index.ts"),
      },
      {
        find: "@iris/database/drizzle/schema/auth",
        replacement: resolve(__dirname, "../../packages/database/src/drizzle/schema/auth.ts"),
      },
      {
        find: "@iris/database/drizzle/schema/sqlite",
        replacement: resolve(__dirname, "../../packages/database/src/drizzle/schema/sqlite.ts"),
      },
      {
        find: "@iris/database/drizzle/schema",
        replacement: resolve(__dirname, "../../packages/database/src/drizzle/schema/index.ts"),
      },
      {
        find: "@iris/database/drizzle/queries",
        replacement: resolve(__dirname, "../../packages/database/src/drizzle/queries/index.ts"),
      },
      {
        find: "@iris/database/drizzle/client",
        replacement: resolve(__dirname, "../../packages/database/src/drizzle/client.ts"),
      },
      {
        find: "@iris/database",
        replacement: resolve(__dirname, "../../packages/database/src/index.ts"),
      },
      {
        find: "@iris/prices/pipeline",
        replacement: resolve(__dirname, "../../packages/prices/src/pipeline/index.ts"),
      },
      {
        find: "@iris/prices/scheduler",
        replacement: resolve(__dirname, "../../packages/prices/src/scheduler/scheduler.ts"),
      },
      {
        find: "@iris/prices/notifications",
        replacement: resolve(__dirname, "../../packages/prices/src/notifications/index.ts"),
      },
      {
        find: "@iris/prices",
        replacement: resolve(__dirname, "../../packages/prices/src/index.ts"),
      },
      {
        find: "@iris/utils/enum-types",
        replacement: resolve(__dirname, "../../packages/utils/src/lib/enum-types.ts"),
      },
      {
        find: "@iris/utils",
        replacement: resolve(__dirname, "../../packages/utils/src/index.ts"),
      },
    ],
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
  },
});
