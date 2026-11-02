import type { ThreadOversightQuery } from "./thread-oversight-type";

/** The oversight list's query string: only the filters given are sent. */
export function toOversightQueryParams(
  query: ThreadOversightQuery,
): Record<string, string | number> {
  const params: Record<string, string | number> = {};
  if (query.status) params.status = query.status;
  if (query.threadType) params.thread_type = query.threadType;
  if (query.studentId) params.student_id = query.studentId;
  if (query.assignedTo) params.assigned_to = query.assignedTo;
  if (query.cursor) params.cursor = query.cursor;
  if (query.pageSize) params.page_size = query.pageSize;
  return params;
}
