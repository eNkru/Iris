import { createAuthClient } from "better-auth/react";
import { inferAdditionalFields, magicLinkClient } from "better-auth/client/plugins";
import type { auth } from "./auth";

/**
 * Client-side auth (authentication.md). Use `authClient.signIn.magicLink`
 * with the user's email; the session hook is available via `useSession`.
 * `inferAdditionalFields` types the `role` additional field on the session
 * user (frontend/authentication.md §2), backing the admin settings UI.
 */
export const authClient = createAuthClient({
  plugins: [inferAdditionalFields<typeof auth>(), magicLinkClient()],
});

export const { useSession, signIn, signOut } = authClient;

export type AuthClientSession = typeof authClient.$Infer.Session;
