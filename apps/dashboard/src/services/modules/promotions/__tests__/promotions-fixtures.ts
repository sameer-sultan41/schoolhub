import { ApiError } from "@schoolhub/api-client";
import type { Page } from "@schoolhub/types";

import type {
  PromotionBatchDetail,
  PromotionBatchRecord,
  PromotionDecisionRecord,
} from "@/services";
import type { BackgroundJobRecord, JobStatus } from "@/services/modules/jobs/jobs-service";
import { CLASS_ID, PLANNED_SESSION_ID, SESSION_ID } from "@/test-fixtures/academics";

// UUID-shaped, like the shared Academics ids: the URL drops a value that isn't one.
export const BATCH_ID = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
export const OTHER_BATCH_ID = "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e";
/** Grade 2: the class after the shared fixtures' Grade 1 (`CLASS_ID`). */
export const NEXT_CLASS_ID = "c3d4e5f6-a7b8-4c9d-8e1f-2a3b4c5d6e7f";
/** Grade 3: a class further up than the one the server proposes. */
export const FAR_CLASS_ID = "d4e5f6a7-b8c9-4d0e-9f2a-3b4c5d6e7f80";
/** Sections of Grade 2 and Grade 3. */
export const NEXT_SECTION_ID = "e5f6a7b8-c9d0-4e1f-8a3b-4c5d6e7f8091";
export const OTHER_SECTION_ID = "f6a7b8c9-d0e1-4f2a-9b4c-5d6e7f8091a2";

/** A draft batch of 24 Grade 1 students moving from 2026-27 to 2027-28; override what a test
 * needs. */
export function promotionBatch(
  overrides: Partial<PromotionBatchRecord> = {},
): PromotionBatchRecord {
  return {
    batch_id: BATCH_ID,
    from_academic_session_id: SESSION_ID,
    from_academic_session_name: "2026-27",
    to_academic_session_id: PLANNED_SESSION_ID,
    to_academic_session_name: "2027-28",
    from_class_id: CLASS_ID,
    from_class_name: "Grade 1",
    status: "draft",
    students: 24,
    started_at: "2026-09-01T12:00:00Z",
    ...overrides,
  };
}

/** One page of the list, as the API answers it (page size 10, the table's default). */
export function promotionBatchPage(
  items: PromotionBatchRecord[],
  { page = 1, totalPages = 1 }: { page?: number; totalPages?: number } = {},
): Page<PromotionBatchRecord> {
  return {
    items,
    pagination: { page, page_size: 10, total_count: items.length, total_pages: totalPages },
  };
}

const ZERO_TIME = "2026-09-01T12:00:00Z";

/** A UUID-shaped id for the nth student of a batch: the URL and the form drop any other shape. */
export function studentUuid(n: number): string {
  return `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
}

/**
 * Ayesha Khan, a draft decision promoting her from Grade 1 to Grade 2 section A, exactly as the
 * server proposed it (so nothing deviates from the proposal). Override what a test needs.
 */
export function promotionDecision(
  overrides: Partial<PromotionDecisionRecord> = {},
): PromotionDecisionRecord {
  return {
    id: studentUuid(1001),
    batch_id: BATCH_ID,
    student_id: studentUuid(1),
    student_name: "Ayesha Khan",
    admission_number: "ADM-0001",
    from_enrollment_id: studentUuid(2001),
    from_academic_session_id: SESSION_ID,
    to_academic_session_id: PLANNED_SESSION_ID,
    from_class_id: CLASS_ID,
    from_class_name: "Grade 1",
    to_class_id: NEXT_CLASS_ID,
    to_class_name: "Grade 2",
    to_section_id: NEXT_SECTION_ID,
    to_section_name: "A",
    decision: "promoted",
    decision_basis: {
      rule: "level+1",
      proposed_decision: "promoted",
      proposed_to_class_id: NEXT_CLASS_ID,
    },
    override_reason: null,
    remarks: null,
    status: "draft",
    approved_by: null,
    approved_at: null,
    executed_at: null,
    created_at: ZERO_TIME,
    updated_at: ZERO_TIME,
    ...overrides,
  };
}

/** `count` students, "Student 1" to "Student {count}", each promoted with a section. */
export function promotionDecisions(count: number): PromotionDecisionRecord[] {
  return Array.from({ length: count }, (_, index) => {
    const number = index + 1;
    return promotionDecision({
      id: studentUuid(1000 + number),
      student_id: studentUuid(number),
      student_name: `Student ${number}`,
      admission_number: `ADM-${number.toString().padStart(4, "0")}`,
    });
  });
}

/** A draft batch with its decisions (Ayesha Khan alone unless `decisions` says otherwise). */
export function promotionBatchDetail(
  overrides: Partial<PromotionBatchDetail> = {},
): PromotionBatchDetail {
  const decisions = overrides.decisions ?? [promotionDecision()];
  return {
    ...promotionBatch({ students: decisions.length }),
    decisions,
    ...overrides,
  };
}

/** A promise the test settles by hand, to hold a request in flight. */
export function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/** An `execute` job as the jobs endpoint answers it; `progress` is 100 once it has succeeded. */
export function jobRecord(
  status: JobStatus,
  extra: Partial<BackgroundJobRecord> = {},
): BackgroundJobRecord {
  return {
    id: "job-1",
    job_type: "promotion.execute",
    status,
    progress: status === "succeeded" ? 100 : 0,
    result: null,
    error: null,
    ...extra,
  };
}

/** The server's refusal of a promotions request, naming `field` (or `non_field` for none). */
export function refusal(status: number, code: string, field: string, issue: string) {
  return new ApiError({
    code,
    message: issue,
    status,
    url: `/student-promotions/${BATCH_ID}`,
    details: [{ field, issue }],
  });
}

/** A business-rule refusal (422), naming `field` (or `non_field` for none). */
export function unprocessable(field: string, issue: string) {
  return refusal(422, "domain_rule_violation", field, issue);
}

/** An error carrying only its status and code: a failed load, or a refusal with no detail. */
export function apiError(status: number, code: string) {
  return new ApiError({ code, message: code, status, url: `/student-promotions/${BATCH_ID}` });
}
