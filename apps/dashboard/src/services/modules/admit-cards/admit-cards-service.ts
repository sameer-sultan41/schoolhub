import { fetchPage } from "@schoolhub/api-client";
import type { Page } from "@schoolhub/types";
import { apiClient } from "@/lib/auth";
import { endpoints } from "@/services/endpoints";
import { toAdmitCardQueryParams, toCurrentAdmitCardQueryParams } from "./admit-cards-helper";
import type {
  AdmitCardDownload,
  AdmitCardIssue,
  AdmitCardIssueAccepted,
  AdmitCardPageQuery,
  AdmitCardRecord,
  CurrentAdmitCardQuery,
} from "./admit-cards-type";

/** The admit-card API calls (`/admit-cards`, `/exams/{id}:issue-admit-cards`), reached through
 * `Services.admitCards.*`. */

/** One cursor page of an exam's cards; the caller's record scope decides which it may see. */
export async function fetchAdmitCardsPage(
  query: AdmitCardPageQuery,
): Promise<Page<AdmitCardRecord>> {
  return fetchPage<AdmitCardRecord>(apiClient, endpoints.admitCards.list, {
    query: toAdmitCardQueryParams(query),
  });
}

/** One cursor page of a child's issued cards for exams that have not ended; the record scope
 * keeps a guardian to their own children. */
export async function fetchCurrentAdmitCardsPage(
  query: CurrentAdmitCardQuery,
): Promise<Page<AdmitCardRecord>> {
  return fetchPage<AdmitCardRecord>(apiClient, endpoints.admitCards.list, {
    query: toCurrentAdmitCardQueryParams(query),
  });
}

/** Creates the missing cards and queues their PDFs: `202` + a job. A re-run tops up and never
 * reinstates a revoked card. `idempotencyKey` makes a double-click replay the first answer. */
export async function issueAdmitCards(
  examId: string,
  idempotencyKey: string,
): Promise<AdmitCardIssue> {
  const { data } = await apiClient.post<AdmitCardIssueAccepted>(
    endpoints.exams.issueAdmitCards(examId),
    undefined,
    { idempotencyKey },
  );
  return { jobId: data.job_id, added: data.added, existing: data.existing };
}

/** Revokes a live card with a reason; the card as it now stands. Already revoked is a 409. */
export async function revokeAdmitCard(id: string, reason: string): Promise<AdmitCardRecord> {
  const { data } = await apiClient.post<AdmitCardRecord>(endpoints.admitCards.revoke(id), {
    reason,
  });
  return data;
}

/** A short-lived signed link to the card's PDF. 404 without a usable file, or once revoked. */
export async function fetchAdmitCardDownloadUrl(id: string): Promise<string> {
  const { data } = await apiClient.post<AdmitCardDownload>(endpoints.admitCards.download(id));
  return data.download_url;
}
