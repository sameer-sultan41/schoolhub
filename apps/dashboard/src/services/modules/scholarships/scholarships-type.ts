import type { ApiSchemas } from "@schoolhub/api-client";

/** Scholarships (`/scholarships`, read with `fees.discount.view`, written with `fees.scholarship.create`): an award with a lifecycle and a sponsor. The generated wire shape (ADR-0017). */
export type ScholarshipRecord = ApiSchemas["Scholarship"];
export type ScholarshipStatus = ApiSchemas["ScholarshipStatusEnum"];
export type ScholarshipType = ApiSchemas["ScholarshipTypeEnum"];
export type ScholarshipCoverage = ApiSchemas["FeeGrantValueTypeEnum"];

export interface ScholarshipsQuery {
  studentId?: string;
  academicSessionId?: string;
  scholarshipType?: ScholarshipType;
  status?: ScholarshipStatus;
  sponsor?: string;
  search?: string;
  ordering?: string;
  cursor?: string;
  pageSize?: number;
}

/** A create sends the required fields; an update sends only the fields given (a PATCH), so a status move is `{ status, notes }`. */
export interface ScholarshipInput {
  studentId: string;
  academicSessionId: string;
  name: string;
  scholarshipType?: ScholarshipType;
  coverageType: ScholarshipCoverage;
  value: string;
  sponsor?: string | null;
  status?: ScholarshipStatus;
  notes?: string | null;
}
