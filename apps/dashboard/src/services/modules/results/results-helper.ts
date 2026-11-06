import type { QueryParams } from "@schoolhub/api-client";
import type { ResultsQuery } from "./results-type";

/** The list's query string: only the filters given are sent. */
export function toResultsQueryParams(query: ResultsQuery): QueryParams {
  const params: QueryParams = {};
  if (query.studentId !== undefined) params.student_id = query.studentId;
  if (query.examId !== undefined) params.exam_id = query.examId;
  if (query.cursor) params.cursor = query.cursor;
  if (query.pageSize) params.page_size = query.pageSize;
  return params;
}
