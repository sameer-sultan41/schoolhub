import type { ApiSchemas } from "@schoolhub/api-client";
import type { GenderValue } from "@schoolhub/types";

/**
 * The students module's domain types — single source of truth, so a type isn't
 * redeclared (even structurally identically) in more than one file. Everything here is
 * re-exported through `./index` and, where a feature file needs it, `@/services`.
 */

/** The generated wire shape — see
 * `docs/decisions/0017-generated-wire-types-for-new-domains.md`. */
export type StudentRecord = ApiSchemas["Student"];

export interface StudentsPageQuery {
  page: number;
  pageSize: number;
  search?: string;
  ordering?: string;
  status?: string;
  campusId?: string;
  houseId?: string;
}

/** camelCase, matching every other service input type in this codebase. Nullable
 * fields are `| null` so a caller can explicitly clear them on update. */
export interface CreateStudentInput {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  gender: GenderValue;
  campusId: string;
  admissionDate: string;
  preferredName?: string | null;
  houseId?: string | null;
  photoFileId?: string | null;
  bloodGroup?: string | null;
  nationality?: string | null;
  religion?: string | null;
  previousSchool?: string | null;
  medicalNotes?: string | null;
  address?: Record<string, unknown> | null;
}

export type UpdateStudentInput = Partial<CreateStudentInput>;

export interface WithdrawStudentInput {
  reason: string;
  effectiveDate: string;
}

/** The directory table's view-model row, derived from `StudentRecord` by
 * `toStudentRow` (`src/features/students/student-row.ts`) and shared by the columns,
 * detail sheet and directory table. */
export interface StudentRow {
  id: string;
  admissionNumber: string;
  name: string;
  status: string;
  campus: string;
  house: string | null;
  admissionDate: string;
  updatedAt: string;
  /** Already resolved through `stableSignedUrl` and normalized to `undefined` (not
   * `null`) once here, so every consumer can pass it straight to `AvatarImage src`
   * without repeating the null-check. */
  signedPhotoUrl: string | undefined;
}
