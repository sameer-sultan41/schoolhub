"use client";

import { useQuery } from "@tanstack/react-query";

import { queryKeys } from "@/lib/query-client";
import { Services } from "@/services";
import { NOTIFICATIONS_QUERY_MODULE } from "@/services/modules/notifications/notifications-constant";

/** The inbox's unread count (`:unread-count`), for the shell's badge. A mark-read or
 * mark-all-read invalidates the whole notifications module, so this refetches with the list. */
export function useUnreadCount() {
  return useQuery({
    queryKey: queryKeys.detail(NOTIFICATIONS_QUERY_MODULE, "unread-count", "current"),
    queryFn: () => Services.notifications.fetchUnreadCount(),
  });
}
