import type { ApiSchemas } from "@schoolhub/api-client";

/** The generated wire shapes (ADR-0017). `effective_to` is optional there: read it `?? null`. */
export type TeacherAllocationRecord = ApiSchemas["TeacherAllocation"];
export type TeacherLoadRow = ApiSchemas["TeacherLoadRow"];

/**
 * One `meta.warnings` entry on a POST/PATCH answer. Hand-written: `meta` is outside the
 * generated per-path schema (a recorded exception to ADR-0017). The server builds it in
 * `apps/api/apps/academics/teacher_allocations/services.py::load_warnings`.
 */
export interface TeacherLoadWarning {
  code: "teacher_over_norm";
  staff_id: string;
  weekly_periods: number;
  norm: number;
}

/**
 * A saved allocation and the advisory warnings that came with it. Hand-written for the same
 * reason as `TeacherLoadWarning`; the warnings come from
 * `apps/api/apps/academics/teacher_allocations/services.py::load_warnings`.
 */
export interface AllocationSaveResult {
  allocation: TeacherAllocationRecord;
  warnings: TeacherLoadWarning[];
}

/** The list is always scoped to one academic session; every other filter is optional. */
export interface TeacherAllocationPageQuery {
  page?: number;
  pageSize?: number;
  search?: string;
  ordering?: string;
  academicSessionId: string;
  classId?: string;
  sectionId?: string;
  subjectId?: string;
  staffId?: string;
  /** `true` is the allocations with no end date (not-yet-started ones too), `false` the ended
   * ones; `undefined` is both. */
  current?: boolean;
}

/** A null `weeklyPeriods` is "no override" (the curriculum's periods apply), a null
 * `effectiveFrom` is "no start date". There is no `effectiveTo`: an allocation is never
 * created already ended. */
export interface AllocateTeacherInput {
  academicSessionId: string;
  sectionId: string;
  subjectId: string;
  staffId: string;
  isPrimary: boolean;
  weeklyPeriods: number | null;
  effectiveFrom: string | null;
}

/** Only the keys present are sent. A null `weeklyPeriods` clears the override, and a null
 * `effectiveTo` makes an ended allocation current again. */
export interface UpdateAllocationInput {
  isPrimary?: boolean;
  weeklyPeriods?: number | null;
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
}

/** What a table row can do to an allocation; each has its own dialog. */
export type AllocationRowAction = "edit" | "end" | "reinstate" | "remove";
