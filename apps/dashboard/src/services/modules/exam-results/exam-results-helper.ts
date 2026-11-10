import { copyMappedFields } from "@/lib/helpers";
import {
  RESULT_OUTCOMES,
  RESULT_OUTCOME_WITHHELD,
  RESULT_QUERY_FIELDS,
  RESULT_STATUSES,
  RESULT_STATUS_PUBLISHED,
} from "./exam-results-constant";
import type {
  ResultOutcome,
  ResultPageQuery,
  ResultRecord,
  ResultStatus,
} from "./exam-results-type";

/** The exam-results module's pure helpers: plain data in, plain data out. */

export function toResultQueryParams(
  query: ResultPageQuery,
): Record<string, string | number | undefined> {
  const params: Record<string, unknown> = { page_size: query.pageSize };
  copyMappedFields(
    query,
    RESULT_QUERY_FIELDS,
    (value) => value !== undefined && value !== "",
    params,
  );
  return params as Record<string, string | number | undefined>;
}

/** A URL status filter -> the query's status: `all`, or anything unknown, is no filter. */
export function resultStatusFilter(value: string): ResultStatus | undefined {
  return RESULT_STATUSES.find((status) => status === value);
}

/** A URL outcome filter -> the query's outcome: `all`, or anything unknown, is no filter. */
export function resultOutcomeFilter(value: string): ResultOutcome | undefined {
  return RESULT_OUTCOMES.find((outcome) => outcome === value);
}

/** Withholding holds a result back from publication, so it applies until the result is published
 * (`withhold_result` refuses after) and is pointless on one already withheld. */
export function mayWithholdResult(result: ResultRecord): boolean {
  return result.status !== RESULT_STATUS_PUBLISHED && result.outcome !== RESULT_OUTCOME_WITHHELD;
}

/** The segregation-of-duties rule's client half (`assert_approver_is_not_the_processor`): the
 * user who ran the latest processing may not approve it. `processed_by` is re-stamped on every
 * run, so after a send-back and a re-process by someone else the original processor may approve. */
export function isProcessor(userId: string | undefined, result: ResultRecord | undefined): boolean {
  return userId !== undefined && result?.processed_by === userId;
}

/** A finished processing job's count of students it computed (`result.students`), or `null`. */
export function processedCount(result: Record<string, unknown> | null): number | null {
  const students = result?.students;
  return typeof students === "number" ? students : null;
}
