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
 */
const link = new RPCLink({
  url: "/api/rpc",
});

export const orpcClient: ApiRouterClient = createORPCClient(link);
