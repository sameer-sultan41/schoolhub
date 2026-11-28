import type { ApiSchemas } from "@schoolhub/api-client";

/** The generated wire shapes (ADR-0017). */
export type ContactSubmissionRecord = ApiSchemas["ContactSubmission"];
export type ContactSubmissionStatus = ApiSchemas["ContactSubmissionStatusEnum"];

/** `createdFrom` (inclusive) and `createdBefore` (exclusive) are ISO date-times bounding `created_at`. */
export interface ContactSubmissionQuery {
  page?: number;
  pageSize?: number;
  search?: string;
  ordering?: string;
  status?: ContactSubmissionStatus;
  createdFrom?: string;
  createdBefore?: string;
}
