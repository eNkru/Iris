import { RPCHandler } from "@orpc/server/fetch";
import { router } from "@iris/api/orpc/router";

/**
 * oRPC HTTP handler for the RPC protocol (orpc-usage.md).
 *
 * The router is mounted under `/api/rpc`: the client link uses base URL
 * `/api/rpc`, and the handler strips that prefix before matching the RPC path
 * (e.g. `POST /api/rpc/products/create` → procedure `products.create`).
 *
 * The procedure context is seeded with the request headers so
 * `protectedProcedure` can resolve the better-auth session cookie.
 */
const handler = new RPCHandler(router);

async function handleRequest(request: Request): Promise<Response> {
  const { matched, response } = await handler.handle(request, {
    prefix: "/api/rpc",
    context: { headers: request.headers },
  });

  if (!matched) {
    return new Response("Not found", { status: 404 });
  }

  return response;
}

export async function GET(request: Request): Promise<Response> {
  return handleRequest(request);
}

export async function POST(request: Request): Promise<Response> {
  return handleRequest(request);
}
