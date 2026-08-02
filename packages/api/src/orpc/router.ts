import type { RouterClient } from "@orpc/server";
import { adminRouter } from "../modules/admin/router";
import { channelsRouter } from "../modules/channels/router";
import { healthRouter } from "../modules/health/router";
import { historyRouter } from "../modules/history/router";
import { productsRouter } from "../modules/products/router";
import { settingsRouter } from "../modules/settings/router";
import { publicProcedure } from "./procedures";

/**
 * Main router composition (orpc-usage.md).
 *
 * Module routers are grouped under `/api`; each module's procedures declare
 * their own paths (e.g. `GET /api/health`). The RPC protocol path is the nested
 * key (e.g. `products.create` → `/api/rpc/products/create`), so procedure names
 * here are also the wire paths for the frontend client.
 */
export const router = publicProcedure.prefix("/api").router({
  health: healthRouter,
  products: productsRouter,
  channels: channelsRouter,
  settings: settingsRouter,
  admin: adminRouter,
  history: historyRouter,
});

/**
 * Type-safe client contract consumed by the frontend
 * (`createORPCClient` / `createTanstackQueryUtils`).
 */
export type ApiRouterClient = RouterClient<typeof router>;
