import { queryKeys } from "@/lib/query-client";
import {
  NOTIFICATIONS_INBOX_RESOURCE,
  NOTIFICATIONS_QUERY_MODULE,
  NOTIFICATIONS_UNREAD_COUNT_RESOURCE,
} from "@/services/modules/notifications/notifications-constant";

/** One inbox page's key; with no params, the prefix every inbox page shares. */
export function inboxListKey(params?: Record<string, unknown>) {
  return queryKeys.list(NOTIFICATIONS_QUERY_MODULE, NOTIFICATIONS_INBOX_RESOURCE, params);
}

/** The unread badge's key. */
export const UNREAD_COUNT_KEY = queryKeys.detail(
  NOTIFICATIONS_QUERY_MODULE,
  NOTIFICATIONS_UNREAD_COUNT_RESOURCE,
  "current",
);
