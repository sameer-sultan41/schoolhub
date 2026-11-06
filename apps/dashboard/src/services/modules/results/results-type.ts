import type { ApiSchemas } from "@schoolhub/api-client";

export type ResultRecord = ApiSchemas["Result"];

export interface ResultsQuery {
  studentId?: string;
  examId?: string;
  cursor?: string;
  pageSize?: number;
}
