import { fetchPage } from "@schoolhub/api-client";
import type { Page } from "@schoolhub/types";
import { apiClient } from "@/lib/auth";
import { endpoints } from "@/services/endpoints";
import { toNotificationsQueryParams } from "./notifications-helper";
import type {
  MarkAllReadResult,
  NotificationMarkReadResult,
  NotificationRecord,
  NotificationsQuery,
  UnreadCount,
} from "./notifications-type";

/** The caller's own inbox (`/notifications`); membership is the authorisation (ADR-0030). */

/** One page of the inbox, newest first. */
export async function listNotifications(
  query: NotificationsQuery = {},
): Promise<Page<NotificationRecord>> {
  return fetchPage<NotificationRecord>(apiClient, endpoints.notifications.list, {
    query: toNotificationsQueryParams(query),
  });
}

/** The unread badge's count. */
export async function fetchUnreadCount(): Promise<UnreadCount> {
  const { data } = await apiClient.get<UnreadCount>(endpoints.notifications.unreadCount);
  return data;
}

/** Stamps one row read. */
export async function markNotificationRead(id: string): Promise<NotificationMarkReadResult> {
  const { data } = await apiClient.post<NotificationMarkReadResult>(
    endpoints.notifications.markRead(id),
  );
  return data;
}

/** Marks every row at or before `before` read (default: now), so a row that arrived after the
 * list rendered is not lost. */
export async function markAllNotificationsRead(before?: string): Promise<MarkAllReadResult> {
  const { data } = await apiClient.post<MarkAllReadResult>(
    endpoints.notifications.markAllRead,
    before === undefined ? {} : { before },
  );
  return data;
}
