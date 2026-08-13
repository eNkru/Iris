/**
 * Thin re-export of AI SDK entry points.
 *
 * Production code imports from here instead of `ai` / `@ai-sdk/openai-compatible`
 * directly so unit tests can mock this module. Vite externalizes those packages
 * (they live under `packages/prices/node_modules`), which makes `vi.mock("ai")`
 * a no-op and would send test traffic at the real provider.
 */
export { generateText, jsonSchema, tool } from "ai";
export type { LanguageModel } from "ai";
export { createOpenAICompatible } from "@ai-sdk/openai-compatible";
