import type { ApiSchemas } from "@schoolhub/api-client";

/** The generated wire shapes (ADR-0017). A result's every field is read-only: it moves only
 * through the exam's colon-actions and `:withhold`. */
export type ResultRecord = ApiSchemas["Result"];
export type ResultStatus = ApiSchemas["ResultStatusEnum"];
export type ResultOutcome = ApiSchemas["ResultOutcomeEnum"];
export type ResultsApproved = ApiSchemas["ResultsApproved"];
export type ResultsPublished = ApiSchemas["ResultsPublished"];
export type ResultsSentBack = ApiSchemas["ResultsSentBack"];

/** One cursor page of one exam's results. */
export interface ResultPageQuery {
  examId: string;
  cursor?: string;
  pageSize?: number;
  ordering?: string;
  sectionId?: string;
  outcome?: ResultOutcome;
  status?: ResultStatus;
}
