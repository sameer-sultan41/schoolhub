import { fetchPage } from "@schoolhub/api-client";
import type { Page } from "@schoolhub/types";
import { apiClient } from "@/lib/auth";
import { endpoints } from "@/services/endpoints";
import type { JobAccepted } from "@/services/modules/jobs/jobs-service";
import { toReportCardQueryParams } from "./report-cards-helper";
import type {
  ReportCardDownload,
  ReportCardPageQuery,
  ReportCardRecord,
  ReportCardRemarksInput,
  ReportCardsPublished,
} from "./report-cards-type";

/** The report-card API calls (`/report-cards`, the exam's report-card colon-actions), reached
 * through `Services.reportCards.*`. */

/** One cursor page of an exam's cards; the caller's record scope decides which it may see. */
export async function fetchReportCardsPage(
  query: ReportCardPageQuery,
): Promise<Page<ReportCardRecord>> {
  return fetchPage<ReportCardRecord>(apiClient, endpoints.reportCards.list, {
    query: toReportCardQueryParams(query),
  });
}

/** Queues generation from the published results: `202` + a render job. A re-run versions a
 * published card and keeps every remark. `idempotencyKey` makes a double-click replay the first. */
export async function generateReportCards(
  examId: string,
  idempotencyKey: string,
): Promise<{ jobId: string }> {
  const { data } = await apiClient.post<JobAccepted>(
    endpoints.exams.generateReportCards(examId),
    undefined,
    { idempotencyKey },
  );
  return { jobId: data.job_id };
}

/** Publishes every rendered card; the server's count of cards it moved. None ready is a 409. */
export async function publishReportCards(examId: string): Promise<ReportCardsPublished> {
  const { data } = await apiClient.post<ReportCardsPublished>(
    endpoints.exams.publishReportCards(examId),
  );
  return data;
}

/** Writes remarks. A field the caller lacks the key for is a 403 naming it; a published card is
 * a 409. */
export async function updateRemarks(
  id: string,
  input: ReportCardRemarksInput,
): Promise<ReportCardRecord> {
  const { data } = await apiClient.patch<ReportCardRecord>(endpoints.reportCards.detail(id), input);
  return data;
}

/** A short-lived signed link to the card's PDF. 404 without a usable file. */
export async function fetchReportCardDownloadUrl(id: string): Promise<string> {
  const { data } = await apiClient.post<ReportCardDownload>(endpoints.reportCards.download(id));
  return data.download_url;
}
