import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  test: {
    dir: "tests",
    setupFiles: ["./tests/setup.ts"],
    environmentMatchGlobs: [
      ["tests/components/**", "jsdom"],
      ["tests/unit/**", "node"],
      ["tests/acceptance/**", "node"],
    ],
  },
  resolve: {
    alias: {
      // `react` / `react-dom` live under `apps/web/node_modules` (pnpm
      // hoists only that workspace). The component test suite pulls them
      // in implicitly via JSX, so resolve them explicitly here.
      react: resolve(__dirname, "apps/web/node_modules/react"),
      "react-dom": resolve(__dirname, "apps/web/node_modules/react-dom"),
      // Same pattern for the React Query + React Router packages the
      // component tests render directly when wrapping the component in
      // `QueryClientProvider` / `MemoryRouter`.
      "@tanstack/react-query": resolve(
        __dirname,
        "apps/web/node_modules/@tanstack/react-query",
      ),
      "react-router": resolve(__dirname, "apps/web/node_modules/react-router"),
      // Workspace aliases must live at the Vite level so unit tests can import
      // `@iris/utils` / `@iris/database`. `test.resolve.alias` is not applied to those.
      "@iris/prices/pipeline": resolve(__dirname, "packages/prices/src/pipeline/index.ts"),
      "@iris/prices": resolve(__dirname, "packages/prices/src/index.ts"),
      "@iris/utils": resolve(__dirname, "packages/utils/src/index.ts"),
      // More-specific aliases MUST come before the bare package alias — Vite
      // resolves aliases by longest-prefix match, so a subpath import like
      // `@iris/database/drizzle/schema/sqlite` would otherwise be captured by
      // the bare `@iris/database` entry below.
      "@iris/database/drizzle/queries": resolve(
        __dirname,
        "packages/database/src/drizzle/queries/index.ts",
      ),
      "@iris/database/drizzle/schema/sqlite": resolve(
        __dirname,
        "packages/database/src/drizzle/schema/sqlite.ts",
      ),
      "@iris/database/drizzle/schema": resolve(
        __dirname,
        "packages/database/src/drizzle/schema/index.ts",
      ),
      "@iris/database": resolve(__dirname, "packages/database/src/index.ts"),
    },
  },
});