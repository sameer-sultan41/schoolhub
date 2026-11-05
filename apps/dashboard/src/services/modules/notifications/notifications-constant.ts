import type { NotificationCategory } from "./notifications-type";

/** The query-key module every inbox read lives under; a mark-read invalidates it. */
export const NOTIFICATIONS_QUERY_MODULE = "notifications";

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
