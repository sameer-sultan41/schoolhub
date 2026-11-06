import {
  listNotifications,
  fetchUnreadCount,
  markNotificationRead,
  markAllNotificationsRead,
} from "./notifications-service";

export const NotificationsService = {
  listNotifications,
  fetchUnreadCount,
  markNotificationRead,
  markAllNotificationsRead,
};
export type {
  MarkAllReadResult,
  NotificationCategory,
  NotificationMarkReadResult,
  NotificationPriority,
  NotificationRecord,
  NotificationsQuery,
  UnreadCount,
} from "./notifications-type";
