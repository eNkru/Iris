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
  // `import()` calls that Node resolves from `node_modules`. This is the
  // correct mechanism for `await import("playwright")` in @iris/prices —
  // a previous `IgnorePlugin`-based approach was wrong: returning `false`
  // from `beforeResolve` makes webpack generate a stub that throws
  // "Cannot find module" at runtime, rather than leaving the module external.
  serverExternalPackages: [
    "pg",
    "better-auth",
    "nodemailer",
    "ioredis",
    "drizzle-orm",
    "ai",
    "@ai-sdk/openai-compatible",
    "p-limit",
    "playwright",
    "playwright-core",
  ],
  webpack: (
    config: {
      resolve?: { fallback?: Record<string, unknown> };
    },
    { isServer }: { isServer: boolean },
  ) => {
    if (isServer) {
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
