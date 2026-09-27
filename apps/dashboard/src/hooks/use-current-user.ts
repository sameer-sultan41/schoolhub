"use client";

import { useQuery } from "@tanstack/react-query";

import { queryKeys } from "@/lib/query-client";
import { Services } from "@/services";

/** The signed-in user — the same cache entry `sidebar-menu.tsx`'s own module gate,
 * `entry-callout.tsx`'s greeting, and `user-dropdown-menu.tsx` already populate
 * (identical `queryKeys.currentUser()` key), so this never issues a second request. */
export function useCurrentUser() {
  return useQuery({
    queryKey: queryKeys.currentUser(),
    queryFn: () => Services.auth.fetchCurrentUser(),
  });
}
