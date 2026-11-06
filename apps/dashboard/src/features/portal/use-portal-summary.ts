"use client";

import { useQuery } from "@tanstack/react-query";

import { queryKeys } from "@/lib/query-client";
import { Services } from "@/services";
import { PARENT_PORTAL_QUERY_MODULE } from "@/services/modules/parent-portal/parent-portal-constant";

/** The portal home summary (children, unread counts, which module tabs are on): the one query
 * the shell and every portal screen share, so there is one cache entry and one request. */
export function usePortalSummary() {
  return useQuery({
    queryKey: queryKeys.detail(PARENT_PORTAL_QUERY_MODULE, "dashboard", "summary"),
    queryFn: () => Services.parentPortal.fetchPortalDashboard(),
  });
}
