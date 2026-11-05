import type { NoticeType } from "@/services";

/** Every notice type to its message key under `portal.notices` (L32: exhaustive). */
export const NOTICE_TYPE_LABEL_KEY: Record<NoticeType, `types.${NoticeType}`> = {
  urgent: "types.urgent",
  general: "types.general",
  circular: "types.circular",
  event: "types.event",
};

export const NOTICE_TYPE_BADGE: Record<
  NoticeType,
  "destructive" | "primary" | "secondary" | "info"
> = {
  urgent: "destructive",
  general: "secondary",
  circular: "primary",
  event: "info",
};
