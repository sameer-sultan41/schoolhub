"use client";

import { useQuery } from "@tanstack/react-query";

import { queryKeys } from "@/lib/query-client";
import { Services } from "@/services";

/** The signed-in user — the one query every consumer shares (`sidebar-menu.tsx`'s
 * module gate, `entry-callout.tsx`'s greeting, `user-dropdown-menu.tsx`, `/staff`'s
 * toolbar and import dialog), so there is exactly one `queryKeys.currentUser()` cache
 * entry and one request, not several call sites that merely happen to match. */
export function useCurrentUser() {
  return useQuery({
    queryKey: queryKeys.currentUser(),
    queryFn: () => Services.auth.fetchCurrentUser(),
  });
}
