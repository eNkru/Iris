"use client";

import { useContext } from "react";
import { SessionContext } from "../lib/session-context";

/**
 * Access the current session (frontend/authentication.md §3). Must be used
 * within `<SessionProvider>`.
 */
export function useSession() {
  const sessionContext = useContext(SessionContext);

  if (sessionContext === undefined) {
    throw new Error("useSession must be used within SessionProvider");
  }

  return sessionContext;
}
