import type { Session } from "better-auth";
import type { Session as AuthSession } from "../auth";
import { auth } from "../auth";

export interface SessionWithUser {
  session: Session;
  /** Inferred user shape including the `role` additional field. */
  user: AuthSession["user"];
}

export interface GetSessionResult {
  session: SessionWithUser | null;
  /** Always false: SQLite is the authoritative local session store. */
  fromCache: boolean;
}

/**
 * Look up the session directly through better-auth. The SQLite database is
 * local and fast enough for the single-container deployment, so an external
 * cache would add failure modes without meaningful benefit.
 */
export async function getSessionWithCache(headers: Headers): Promise<GetSessionResult> {
  const session = await auth.api.getSession({ headers });
  return { session, fromCache: false };
}
