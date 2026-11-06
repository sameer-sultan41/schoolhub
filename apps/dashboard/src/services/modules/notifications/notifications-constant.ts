import type { NotificationCategory } from "./notifications-type";

/** The query-key module every inbox read lives under; a mark-all-read invalidates it. */
export const NOTIFICATIONS_QUERY_MODULE = "notifications";
/** The inbox list's resource under that module (one cache entry per filter and cursor). */
export const NOTIFICATIONS_INBOX_RESOURCE = "inbox";
/** The unread badge's resource under that module. */
export const NOTIFICATIONS_UNREAD_COUNT_RESOURCE = "unread-count";

/** Every category, in display order. A `Record` over the generated enum, so a new member fails
 * to compile until it is listed here (the i18n label map is keyed by these). */
const CATEGORY_ORDER: Record<NotificationCategory, true> = {
  attendance: true,
  fees: true,
  exams: true,
  academic: true,
  library: true,
  transport: true,
  general: true,
  emergency: true,
};

function isCategory(key: string): key is NotificationCategory {
  return key in CATEGORY_ORDER;
}

export const NOTIFICATION_CATEGORIES: readonly NotificationCategory[] =
  Object.keys(CATEGORY_ORDER).filter(isCategory);
