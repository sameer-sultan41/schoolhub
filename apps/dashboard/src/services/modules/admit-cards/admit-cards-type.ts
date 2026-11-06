import type { ApiSchemas } from "@schoolhub/api-client";

/** The generated wire shapes (ADR-0017). Every field of a card is read-only: it moves only
 * through `:issue-admit-cards` and `:revoke`. */
export type AdmitCardRecord = ApiSchemas["AdmitCard"];
export type AdmitCardStatus = ApiSchemas["AdmitCardStatusEnum"];
export type AdmitCardDownload = ApiSchemas["CardDownload"];
export type AdmitCardIssueAccepted = ApiSchemas["AdmitCardIssueAccepted"];

/** One cursor page of one exam's cards. */
export interface AdmitCardPageQuery {
  examId: string;
  cursor?: string;
  pageSize?: number;
  ordering?: string;
  sectionId?: string;
  status?: AdmitCardStatus;
}

/** `:issue-admit-cards`' `202`: the render job to poll, and the server's own counts of cards this
 * run added and cards that already existed. */
export interface AdmitCardIssue {
  jobId: string;
  added: number;
  existing: number;
}
