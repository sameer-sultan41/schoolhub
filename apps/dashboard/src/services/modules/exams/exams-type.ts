import type { ApiSchemas } from "@schoolhub/api-client";

/** The generated wire shapes (ADR-0017). The names, counts and status are read-only. */
export type ExamRecord = ApiSchemas["Exam"];
export type ExamStatus = ApiSchemas["ExamStatusEnum"];
export type ExamType = ApiSchemas["ExamTypeEnum"];

export interface ExamPageQuery {
  page?: number;
  pageSize?: number;
  search?: string;
  ordering?: string;
  academicSessionId?: string;
  termId?: string;
  status?: ExamStatus;
  examType?: ExamType;
}

/** A null `termId`, date or `description` clears it; a null `gradingScaleId` is left out, so a
 * new exam takes the school's default scale and an edit keeps its own. */
export interface ExamInput {
  name: string;
  academicSessionId: string;
  termId: string | null;
  examType: ExamType;
  gradingScaleId: string | null;
  weightagePercent: string;
  startsOn: string | null;
  endsOn: string | null;
  description: string | null;
}
