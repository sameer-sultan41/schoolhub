import type { ApiSchemas } from "@schoolhub/api-client";

export type NoticeRecord = ApiSchemas["Notice"];
export type PortalNoticeRecord = ApiSchemas["PortalNotice"];
/** `/notices` answers the staff shape or the portal shape, by caller. */
export type NoticeRead = ApiSchemas["NoticeRead"];
export type NoticeType = ApiSchemas["NoticeTypeEnum"];

/** A guardian may filter on `noticeType` and `requiresAcknowledgment` only. */
export interface NoticesQuery {
  noticeType?: NoticeType;
  requiresAcknowledgment?: boolean;
  cursor?: string;
  pageSize?: number;
}
