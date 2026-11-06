import type { QueryParams } from "@schoolhub/api-client";
import type { NoticeRead, NoticesQuery, PortalNoticeRecord } from "./notices-type";

/** The list's query string: only the filters given are sent. */
export function toNoticesQueryParams(query: NoticesQuery): QueryParams {
  const params: QueryParams = {};
  if (query.noticeType !== undefined) params.notice_type = query.noticeType;
  if (query.requiresAcknowledgment !== undefined)
    params.requires_acknowledgment = query.requiresAcknowledgment;
  if (query.cursor) params.cursor = query.cursor;
  if (query.pageSize) params.page_size = query.pageSize;
  return params;
}

/** Narrows the staff-or-portal union: the staff shape alone carries `status`. */
export function isPortalNotice(notice: NoticeRead): notice is PortalNoticeRecord {
  return !("status" in notice);
}
