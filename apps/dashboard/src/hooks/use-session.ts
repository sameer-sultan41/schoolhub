"use client";

import type { AuthenticatedUser, PermissionKey } from "@schoolhub/types";
import { useQuery } from "@tanstack/react-query";
import { restoreSession } from "@/lib/auth";
import { SESSION_QUERY_STALE_TIME_MS } from "@/lib/constants";
import { hasAnyPermission, hasPermission } from "@/lib/permissions";
import { queryKeys, shouldRetry } from "@/lib/query-client";

/**
 * The signed-in user and their effective permissions.
 *
 * On a cold load there is no access token in memory, so this first exchanges the HttpOnly
 * refresh cookie for one. Returns `null` (not an error) when the session is over — the
 * proxy has already routed anonymous visitors to /login.
 *
 * `retry: false` would be right if every rejection meant "signed out", but it does not:
 * `restoreSession` now rethrows a throttled or unavailable refresh instead of reporting
 * it as a dead session, and that is precisely the case worth retrying. The shared policy
 * retries only transient failures, so a real 401 still resolves to `null` immediately.
 */
export function useSession() {
  const query = useQuery<AuthenticatedUser | null>({
    queryKey: queryKeys.session(),
    queryFn: restoreSession,
    staleTime: SESSION_QUERY_STALE_TIME_MS,
    retry: shouldRetry,
  });

  return {
    user: query.data ?? null,
    isLoading: query.isPending,
    isAuthenticated: Boolean(query.data),
    refetch: query.refetch,
  };
}

/** `const canCreateInvoice = usePermission("fees.invoice.create");` */
export function usePermission(permission: PermissionKey): boolean {
  const { user } = useSession();
  return hasPermission(user, permission);
}

export function useAnyPermission(permissions: PermissionKey[]): boolean {
  const { user } = useSession();
  return hasAnyPermission(user, permissions);
}
