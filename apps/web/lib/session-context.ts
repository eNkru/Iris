"use client";

import type { AuthClientSession } from "@iris/auth/client";
import { createContext } from "react";

/**
 * Session context shape (frontend/authentication.md §3).
 */
export type SessionContextValue = {
  session: AuthClientSession["session"] | null;
  user: AuthClientSession["user"] | null;
  /** True once the session has been resolved (including "not signed in"). */
  loaded: boolean;
  reloadSession: () => Promise<void>;
};

export const SessionContext = createContext<SessionContextValue | undefined>(undefined);
