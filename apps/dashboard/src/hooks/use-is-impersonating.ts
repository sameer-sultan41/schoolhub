"use client";

import { useSyncExternalStore } from "react";

import { accessTokenStore, isImpersonationToken } from "@/lib/auth";

function subscribe(listener: () => void): () => void {
  return accessTokenStore.subscribe(() => {
    listener();
  });
}

const read = () => isImpersonationToken(accessTokenStore.get());

/**
 * Whether this tab's session is an impersonation: its access token's `amr` says so (ADR-0037).
 * Follows the token as it is set and cleared. UX only: the API checks the grant on every request.
 */
export function useIsImpersonating(): boolean {
  return useSyncExternalStore(subscribe, read, () => false);
}
