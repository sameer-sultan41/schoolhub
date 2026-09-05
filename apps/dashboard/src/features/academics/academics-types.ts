/**
 * Hand-declared wire types for the academics API, matching the convention every
 * other feature in this app uses (see staff-types.ts / student-types.ts):
 * snake_case fields mirroring the DRF serializers, and no import of the
 * generated `ApiSchemas`/`paths` types — the academics paths are not in
 * packages/api-client/src/schema.d.ts yet.
 *
 * Source of truth: apps/api/apps/academics/serializers.py and views.py.
 */

/** One entry of `class_subjects.term_plans` (a JSON column). Only `term_id` is
 * validated server-side — see services.assert_term_plans_reference_session_terms. */
export interface TermPlanEntry {
  term_id: string;
  topics?: string[];
}

/** Mirrors apps.academics.serializers.CurriculumSerializer. */
export interface CurriculumRecord {
  id: string;
  academic_session_id: string;
  class_id: string;
  subject_id: string;
  campus_id: string | null;
  is_elective: boolean;
  elective_group: string | null;
  weekly_periods: number;
  syllabus_file_id: string | null;
  term_plans: TermPlanEntry[] | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

/** `POST /class-subjects:clone` — services.clone_curriculum's return value. */
export interface CloneCurriculumResult {
  created: number;
  skipped: number;
}

/** Mirrors apps.academics.serializers.TeacherAllocationSerializer. */
export interface TeacherAllocationRecord {
  id: string;
  academic_session_id: string;
  section_id: string;
  subject_id: string;
  staff_id: string;
  is_primary: boolean;
  weekly_periods: number | null;
  effective_from: string | null;
  effective_to: string | null;
  created_at: string;
  updated_at: string;
}

/** Advisory only — services.load_warnings never raises, it rides in the body. */
export interface AllocationLoadWarning {
  code: string;
  staff_id: string;
  weekly_periods: number;
  norm: number;
}

/** `GET /teacher-subject-allocations/load-summary?academic_session_id=…`. */
export interface TeacherLoadSummaryRow {
  staff_id: string;
  name: string;
  weekly_periods: number;
  allocations: number;
  over_norm: boolean;
}

/** apps.academics.models.PromotionDecision. */
export type PromotionDecisionValue = "promoted" | "retained" | "promoted_on_trial" | "graduated";

/** apps.academics.models.PromotionStatus — batch-wide, every row moves together. */
export type PromotionStatusValue =
  "draft" | "pending_approval" | "approved" | "executed" | "reverted";

/** Mirrors apps.academics.serializers.PromotionDecisionSerializer. */
export interface PromotionDecisionRecord {
  id: string;
  batch_id: string;
  student_id: string;
  from_enrollment_id: string;
  from_academic_session_id: string;
  to_academic_session_id: string;
  from_class_id: string;
  to_class_id: string | null;
  to_section_id: string | null;
  decision: PromotionDecisionValue;
  decision_basis: Record<string, unknown> | null;
  override_reason: string | null;
  remarks: string | null;
  status: PromotionStatusValue;
  approved_by: string | null;
  approved_at: string | null;
  executed_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * `GET /student-promotions` — one entry per batch, aggregated server-side.
 * There is no `promotion_batches` table; a batch is derived from its rows, so
 * this is read-only.
 */
export interface PromotionBatchRecord {
  batch_id: string;
  from_academic_session_id: string;
  to_academic_session_id: string;
  from_class_id: string;
  status: PromotionStatusValue;
  students: number;
  started_at: string;
}

/** `GET /student-promotions/{batch_id}` — the batch plus its decisions. */
export interface PromotionBatchDetail extends PromotionBatchRecord {
  decisions: PromotionDecisionRecord[];
}

/** `POST /student-promotions` — views.PromotionBatchViewSet.create_batch. */
export interface CreatePromotionBatchResult {
  batch_id: string;
  students: number;
}

/** `:submit` / `:approve` / `:reject` / `:revert` all return a row count. */
export interface PromotionActionResult {
  updated: number;
}

export interface PromotionReportEntry {
  student_id: string;
  reason?: string;
  error?: string;
}

/**
 * `services.execute_batch`'s per-student report. Not the `:execute` response —
 * that is a `202` carrying a job id — but the `result` of the job it queues, read
 * back from `GET /jobs/{id}`.
 */
export interface PromotionExecutionReport {
  enrolled: PromotionReportEntry[];
  graduated: PromotionReportEntry[];
  skipped: PromotionReportEntry[];
  failed: PromotionReportEntry[];
}

/** Mirrors apps.school_organization.serializers.SubjectSerializer (option subset). */
export interface SubjectOption {
  id: string;
  name: string;
  code: string;
  is_active: boolean;
}

/** Mirrors apps.staff_management.serializers.StaffSerializer (option subset). */
export interface TeachingStaffOption {
  id: string;
  employee_number: string;
  first_name: string;
  last_name: string;
}
