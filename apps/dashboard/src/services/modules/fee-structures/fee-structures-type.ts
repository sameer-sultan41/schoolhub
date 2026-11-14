import type { ApiSchemas } from "@schoolhub/api-client";

/** Fee structures (`/fee-structures`, `fees.fee-structure.*`): a named fee set with its lifecycle (draft, active, archived). A structure carries its schedules, read-only. The generated wire shape (ADR-0017). */
export type FeeStructureRecord = ApiSchemas["FeeStructure"];
export type FeeStructureStatus = ApiSchemas["FeeStructureStatusEnum"];

export interface FeeStructuresQuery {
  search?: string;
  ordering?: string;
  academicSessionId?: string;
  classId?: string;
  campusId?: string;
  status?: FeeStructureStatus;
  cursor?: string;
  pageSize?: number;
}

/** A create sends the required fields; an update sends only the fields given (a PATCH). A `null` clears a nullable field. */
export interface FeeStructureInput {
  name: string;
  academicSessionId: string;
  classId?: string | null;
  campusId?: string | null;
}
