import { fetchPage } from "@schoolhub/api-client";
import type { Page } from "@schoolhub/types";
import { apiClient } from "@/lib/auth";
import { endpoints } from "@/services/endpoints";
import type { JobAccepted } from "@/services/modules/jobs/jobs-service";
import { toResultQueryParams } from "./exam-results-helper";
import type {
  ResultPageQuery,
  ResultRecord,
  ResultsApproved,
  ResultsPublished,
  ResultsSentBack,
} from "./exam-results-type";

/** The result API calls (`/results`, the exam's result colon-actions), reached through
 * `Services.examResults.*`. */

/** One cursor page of an exam's results; the caller's record scope decides which it may see. */
export async function fetchResultsPage(query: ResultPageQuery): Promise<Page<ResultRecord>> {
  return fetchPage<ResultRecord>(apiClient, endpoints.results.list, {
    query: toResultQueryParams(query),
  });
}

/** Queues processing: `202` + a job. Refused with a 409 while marks are outstanding or once the
 * results are approved. `idempotencyKey` makes a double-click replay the first answer. */
export async function processResults(
  examId: string,
  idempotencyKey: string,
): Promise<{ jobId: string }> {
  const { data } = await apiClient.post<JobAccepted>(
    endpoints.exams.processResults(examId),
    undefined,
    { idempotencyKey },
  );
  return { jobId: data.job_id };
}

/** Approves every pending result. The latest processor approving is a 422 naming `approved_by`. */
export async function approveResults(examId: string): Promise<ResultsApproved> {
  const { data } = await apiClient.post<ResultsApproved>(endpoints.exams.approveResults(examId));
  return data;
}

/** Returns the exam to marks entry with a reason; the server's count of results it reopened. */
export async function sendResultsBack(examId: string, reason: string): Promise<ResultsSentBack> {
  const { data } = await apiClient.post<ResultsSentBack>(endpoints.exams.sendResultsBack(examId), {
    reason,
  });
  return data;
}

/** Publishes the approved results; the server's counts of results published and withheld. */
export async function publishResults(examId: string): Promise<ResultsPublished> {
  const { data } = await apiClient.post<ResultsPublished>(endpoints.exams.publishResults(examId));
  return data;
}

/** Withholds one result from publication with a reason; the result as it now stands. */
export async function withholdResult(id: string, reason: string): Promise<ResultRecord> {
  const { data } = await apiClient.post<ResultRecord>(endpoints.results.withhold(id), { reason });
  return data;
}
