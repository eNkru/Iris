import { loadEnvConfig } from "@next/env";
import path from "node:path";
import type { NextConfig } from "next";

// Next.js only auto-loads env files from the app directory. The monorepo keeps
// a single canonical `.env` at the repo root, so load it explicitly before the
// build/dev server starts (auth/api packages validate it via @iris/utils).
// `forceReload` is required because Next may have already called loadEnvConfig
// for the app directory in this process (the module caches its result).
loadEnvConfig(path.join(process.cwd(), "../.."), process.env.NODE_ENV === "development", console, true);

const nextConfig: NextConfig = {
  // Workspace packages ship TypeScript sources; let Next.js compile them.
  transpilePackages: ["@iris/api", "@iris/auth", "@iris/database", "@iris/prices", "@iris/utils"],
  // Node-only dependencies used by server code (auth route, oRPC handlers,
  // scheduler, AI pipeline): keep them external instead of bundling.
  //
  // `serverExternalPackages` externalises all imports of these packages
  // (static and dynamic) so webpack leaves them as runtime `require()` /
  // `import()` calls that Node resolves from `node_modules`.
  //
  // Note: `playwright` / `playwright-core` were previously listed here for the
  // old Chromium transport. They are removed — the fetch transport is now a
  // thin HTTP client for the Camoufox sidecar (no browser deps in the app).
  serverExternalPackages: [
    "better-sqlite3",
    "better-auth",
    "nodemailer",
    "drizzle-orm",
    "ai",
    "@ai-sdk/openai-compatible",
    "p-limit",
  ],
  webpack: (
    config: {
      resolve?: { fallback?: Record<string, unknown> };
      externals?: unknown[];
    },
    { isServer }: { isServer: boolean },
  ) => {
    if (isServer) {
      // `better-sqlite3` contains a native addon loaded through the `bindings`
      // package. Explicitly externalize it as well as listing it in
      // `serverExternalPackages`; this is required when Next transpiles the
      // workspace database package and otherwise bundles the addon loader into
      // `.next` (where its relative native-binding lookup cannot succeed).
      config.externals = [
        ...(config.externals ?? []),
        { "better-sqlite3": "commonjs better-sqlite3" },
      ];

      config.resolve = config.resolve ?? {};
      config.resolve.fallback = {
        ...(config.resolve.fallback ?? {}),
        electron: false,
      };
    }
    return config;
  },
};

export default nextConfig;
