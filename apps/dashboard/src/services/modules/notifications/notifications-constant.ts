import type { NotificationCategory } from "./notifications-type";

/** The query-key module every inbox read lives under; a mark-all-read invalidates it. */
export const NOTIFICATIONS_QUERY_MODULE = "notifications";
/** The inbox list's resource under that module (one cache entry per filter and cursor). */
export const NOTIFICATIONS_INBOX_RESOURCE = "inbox";
/** The unread badge's resource under that module. */
export const NOTIFICATIONS_UNREAD_COUNT_RESOURCE = "unread-count";

/** Every category the server emits, in display order (the i18n label map is keyed by these). */
export const NOTIFICATION_CATEGORIES = [
  "attendance",
  "fees",
  "exams",
  "academic",
  "library",
  "transport",
  "general",
  "emergency",
] as const satisfies readonly NotificationCategory[];
