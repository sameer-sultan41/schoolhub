import type { ApiSchemas } from "@schoolhub/api-client";

/** The generated wire shapes (ADR-0017). */
export type ContactSubmissionRecord = ApiSchemas["ContactSubmission"];
export type ContactSubmissionStatus = ApiSchemas["ContactSubmissionStatusEnum"];

/** `createdFrom`/`createdTo` are ISO date-times bounding `created_at`. */
export interface ContactSubmissionQuery {
  page?: number;
  pageSize?: number;
  search?: string;
  ordering?: string;
  status?: ContactSubmissionStatus;
  createdFrom?: string;
  createdTo?: string;
}
