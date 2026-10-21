import type { ApiSchemas } from "@schoolhub/api-client";

/** The generated wire shapes (ADR-0017). */
export type TeacherSubstitutionRecord = ApiSchemas["TeacherSubstitution"];
export type SubstitutionStatus = ApiSchemas["TeacherSubstitutionStatusEnum"];
export type SubstituteCandidate = ApiSchemas["SubstituteCandidate"];

export interface SubstitutionPageQuery {
  page?: number;
  pageSize?: number;
  search?: string;
  ordering?: string;
  status?: SubstitutionStatus;
  /** Inclusive `YYYY-MM-DD` bounds on the cover's date. */
  dateFrom?: string;
  dateTo?: string;
}

/** A null room keeps the class in its timetabled room; a null reason is none. */
export interface ProposeSubstitutionInput {
  timetableSlotId: string;
  date: string;
  absentStaffId: string;
  substituteStaffId: string;
  roomId: string | null;
  reason: string | null;
}
