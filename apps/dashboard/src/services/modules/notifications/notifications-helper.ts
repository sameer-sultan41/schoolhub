import type { QueryParams } from "@schoolhub/api-client";
import type { NotificationsQuery } from "./notifications-type";

/** The list's query string: only the filters given are sent. */
export function toNotificationsQueryParams(query: NotificationsQuery): QueryParams {
  const params: QueryParams = {};
  if (query.read !== undefined) params.read = query.read;
  if (query.category !== undefined) params.category = query.category;
  if (query.cursor) params.cursor = query.cursor;
  if (query.pageSize) params.page_size = query.pageSize;
  return params;
}
