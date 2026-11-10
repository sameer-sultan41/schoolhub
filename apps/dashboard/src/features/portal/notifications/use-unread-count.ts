"use client";

import { useQuery } from "@tanstack/react-query";

import { Services } from "@/services";
import { UNREAD_COUNT_KEY } from "./notification-query-keys";

/** The inbox's unread count (`:unread-count`), for the shell's badge. A mark-read invalidates
 * this key; a mark-all-read invalidates the whole notifications module, list included. */
export function useUnreadCount() {
  return useQuery({
    queryKey: UNREAD_COUNT_KEY,
    queryFn: () => Services.notifications.fetchUnreadCount(),
  });
}
