import type { NoticeType } from "./notices-type";

/** The query-key module every notice read lives under; an acknowledge invalidates it. */
export const NOTICES_QUERY_MODULE = "notices";

/** Every notice type, in display order (the i18n label map is keyed by these). */
export const NOTICE_TYPES = [
  "urgent",
  "general",
  "circular",
  "event",
] as const satisfies readonly NoticeType[];
