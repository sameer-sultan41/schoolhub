import type { ApiSchemas } from "@schoolhub/api-client";

/** The generated wire shapes (ADR-0017). `PromotionDecision`'s target class, target section,
 * override reason and remarks are optional there: read them `?? null`. */
export type PromotionBatchRecord = ApiSchemas["PromotionBatch"];
export type PromotionBatchDetail = ApiSchemas["PromotionBatchDetail"];
export type PromotionDecisionRecord = ApiSchemas["PromotionDecision"];
export type PromotionStatus = ApiSchemas["PromotionStatusEnum"];
export type PromotionDecisionValue = ApiSchemas["PromotionDecisionEnum"];
export type PromotionBatchCreated = ApiSchemas["PromotionBatchCreated"];
export type PromotionTransitionResult = ApiSchemas["PromotionTransitionResult"];
export type CreatePromotionBatchRequest = ApiSchemas["CreatePromotionBatch"];

/** The batch transitions that answer `200` + `{updated}`; each is also its `endpoints.promotions`
 * key. `execute` is not one: it answers `202` + a job. */
export type PromotionTransition = "submit" | "approve" | "reject" | "revert";

/** Everything a reviewer can do to a batch: the four transitions, and `execute` (a job). */
export type PromotionAction = PromotionTransition | "execute";

/** What the server proposed when it drafted a row, read back from `decision_basis`. */
export interface PromotionProposal {
  decision: PromotionDecisionValue;
  /** `null` for a graduating proposal. */
  toClassId: string | null;
}

/**
 * The `promotion.execute` job's `result`. Hand-written: the job's `result` is outside the
 * generated schema (a recorded exception to ADR-0017). The server builds it in
 * `apps/api/apps/academics/promotions/services.py::execute_batch`.
 */
export interface PromotionExecutionReport {
  enrolled: { student_id: string }[];
  graduated: { student_id: string }[];
  skipped: { student_id: string; reason: string }[];
  failed: { student_id: string; error: string }[];
}

/** Every filter is optional; with no `ordering` the server's own order (newest batch first)
 * applies. */
export interface PromotionBatchesQuery {
  page?: number;
  pageSize?: number;
  ordering?: string;
  status?: string;
  fromAcademicSessionId?: string;
  fromClassId?: string;
}

export interface CreatePromotionBatchInput {
  fromAcademicSessionId: string;
  toAcademicSessionId: string;
  classId: string;
}

/** Only the keys present are sent. A null `toClassId`, `toSectionId`, `overrideReason` or
 * `remarks` clears the stored value. */
export interface UpdateDecisionInput {
  decision?: PromotionDecisionValue;
  toClassId?: string | null;
  toSectionId?: string | null;
  overrideReason?: string | null;
  remarks?: string | null;
}
