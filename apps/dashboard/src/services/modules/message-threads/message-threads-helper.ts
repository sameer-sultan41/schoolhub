import type { MessageThreadsQuery, MessagesQuery } from "./message-threads-type";

/** The inbox's query string: only the filters given are sent. */
export function toThreadsQueryParams(query: MessageThreadsQuery): Record<string, string | number> {
  const params: Record<string, string | number> = {};
  if (query.status) params.status = query.status;
  if (query.threadType) params.thread_type = query.threadType;
  if (query.studentId) params.student_id = query.studentId;
  if (query.cursor) params.cursor = query.cursor;
  if (query.pageSize) params.page_size = query.pageSize;
  return params;
}

/** A conversation page's query string. */
export function toMessagesQueryParams(query: MessagesQuery): Record<string, string | number> {
  const params: Record<string, string | number> = {};
  if (query.cursor) params.cursor = query.cursor;
  if (query.pageSize) params.page_size = query.pageSize;
  return params;
}
