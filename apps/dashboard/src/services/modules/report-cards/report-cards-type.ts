import type { ApiSchemas } from "@schoolhub/api-client";

export type ReportCardRecord = ApiSchemas["ReportCard"];

export interface ReportCardsQuery {
  studentId?: string;
  examId?: string;
  termId?: string;
  cursor?: string;
  pageSize?: number;
}
