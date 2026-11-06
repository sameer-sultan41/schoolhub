import type { ApiSchemas } from "@schoolhub/api-client";

export type NotificationRecord = ApiSchemas["Notification"];
export type NotificationCategory = ApiSchemas["NotificationCategoryEnum"];
export type NotificationPriority = ApiSchemas["PriorityEnum"];
export type NotificationMarkReadResult = ApiSchemas["NotificationMarkReadResult"];
export type MarkAllReadResult = ApiSchemas["MarkAllReadResult"];
export type UnreadCount = ApiSchemas["UnreadCount"];

export interface NotificationsQuery {
  /** `true` = read, `false` = unread, omitted = both. */
  read?: boolean;
  category?: NotificationCategory;
  cursor?: string;
  pageSize?: number;
}
