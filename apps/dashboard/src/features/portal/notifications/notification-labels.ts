import type { NotificationCategory, NotificationPriority } from "@/services";

/** Every category to its message key under `portal.notifications` (L32: exhaustive). */
export const NOTIFICATION_CATEGORY_LABEL_KEY: Record<
  NotificationCategory,
  `categories.${NotificationCategory}`
> = {
  attendance: "categories.attendance",
  fees: "categories.fees",
  exams: "categories.exams",
  library: "categories.library",
  transport: "categories.transport",
  academic: "categories.academic",
  general: "categories.general",
  emergency: "categories.emergency",
};

export const NOTIFICATION_PRIORITY_LABEL_KEY: Record<
  NotificationPriority,
  `priorities.${NotificationPriority}`
> = {
  normal: "priorities.normal",
  high: "priorities.high",
  emergency: "priorities.emergency",
};

export const NOTIFICATION_PRIORITY_BADGE: Record<
  NotificationPriority,
  "secondary" | "warning" | "destructive"
> = {
  normal: "secondary",
  high: "warning",
  emergency: "destructive",
};
