import type { QueryParams } from "@schoolhub/api-client";
import type { ReportCardsQuery } from "./report-cards-type";

/** The list's query string: only the filters given are sent. */
export function toReportCardsQueryParams(query: ReportCardsQuery): QueryParams {
  const params: QueryParams = {};
  if (query.studentId !== undefined) params.student_id = query.studentId;
  if (query.examId !== undefined) params.exam_id = query.examId;
  if (query.termId !== undefined) params.term_id = query.termId;
  if (query.cursor) params.cursor = query.cursor;
  if (query.pageSize) params.page_size = query.pageSize;
  return params;
}
