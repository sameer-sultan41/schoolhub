import type { ApiSchemas } from "@schoolhub/api-client";

/** Fines (`/fines`, `fees.fine.*`): a penalty folded onto the student's next invoice. The generated wire shape (ADR-0017). */
export type FineRecord = ApiSchemas["Fine"];
export type FineStatus = FineRecord["status"];
export type FineType = ApiSchemas["FineTypeEnum"];

export interface FinesQuery {
  studentId?: string;
  feeHeadId?: string;
  fineType?: FineType;
  status?: FineStatus;
  sourceModule?: string;
  search?: string;
  ordering?: string;
  cursor?: string;
  pageSize?: number;
}

/** A create sends the required fields; an update sends only the fields given (a PATCH). */
export interface FineInput {
  studentId: string;
  feeHeadId: string;
  fineType?: FineType;
  amount: string;
  reason: string;
}
