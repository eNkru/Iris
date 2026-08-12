"use client";

import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { ApiRouterClient } from "@iris/api/orpc/router";

/**
 * Type-safe oRPC client (frontend/orpc-usage.md).
 *
 * The link posts to the RPC handler mounted at `/api/rpc`; the session cookie
 * is sent automatically (same-origin), so `protectedProcedure` resolves the
 * user on the server.
 *
 * `url` must be absolute: @orpc/client resolves it with `new URL()` and would
 * throw on a bare relative path. It is provided as a function so it is only
 * evaluated in the browser at call time (never during SSR).
 */
const link = new RPCLink({
  url: () => `${window.location.origin}/api/rpc`,
});

export const orpcClient: ApiRouterClient = createORPCClient(link);
