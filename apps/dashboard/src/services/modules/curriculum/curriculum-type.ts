import type { ApiSchemas } from "@schoolhub/api-client";

/** The generated wire shapes (ADR-0017). */
export type CurriculumRecord = ApiSchemas["Curriculum"];
export type CloneCurriculumRequest = ApiSchemas["CloneCurriculumRequest"];
export type CloneCurriculumResult = ApiSchemas["CloneCurriculumResult"];

/** The list is always scoped to one academic session; every other filter is optional. */
export interface CurriculumPageQuery {
  page?: number;
  pageSize?: number;
  search?: string;
  ordering?: string;
  academicSessionId: string;
  classId?: string;
  campusId?: string;
  /** `false` filters to core subjects, so only `undefined` means "either". */
  isElective?: boolean;
}

/** A null `campusId` is "all campuses". Session, class and subject are fixed once created. */
export interface CurriculumInput {
  academicSessionId: string;
  classId: string;
  subjectId: string;
  campusId: string | null;
  isElective: boolean;
  electiveGroup: string | null;
  weeklyPeriods: number;
  notes: string | null;
}
