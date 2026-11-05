import {
  listNotifications,
  fetchNotification,
  fetchUnreadCount,
  markNotificationRead,
  markAllNotificationsRead,
} from "./notifications-service";

export const NotificationsService = {
  listNotifications,
  fetchNotification,
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
