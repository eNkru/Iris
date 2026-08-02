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
  serverExternalPackages: [
    "pg",
    "better-auth",
    "nodemailer",
    "ioredis",
    "drizzle-orm",
    "ai",
    "@ai-sdk/openai",
    "@ai-sdk/google",
    "@ai-sdk/anthropic",
    "p-limit",
    "wreq-js",
  ],
};

export default nextConfig;
