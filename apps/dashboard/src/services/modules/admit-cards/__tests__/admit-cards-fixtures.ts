import type { Page } from "@schoolhub/types";

import type { AdmitCardRecord } from "@/services";
import { EXAM_ID } from "@/services/modules/exams/__tests__/exams-fixtures";
import {
  OTHER_SECTION_ID,
  SECTION_ID,
} from "@/services/modules/exam-schedules/__tests__/exam-schedules-fixtures";

export { OTHER_SECTION_ID, SECTION_ID };

// UUID-shaped: a filter drops an id that isn't one.
export const CARD_ID = "68a9b0c1-d2e3-4f05-8c6a-ef5667788990";
export const OTHER_CARD_ID = "79b0c1d2-e3f4-4016-9d7b-f06778899001";
export const STUDENT_ID = "8ac1d2e3-f405-4127-ae8c-017889900112";
export const FILE_ID = "9bd2e3f4-0516-4238-bf9d-128990011223";

/** Ali Raza's rendered card for section A; override what a test needs. */
export function admitCardRecord(overrides: Partial<AdmitCardRecord> = {}): AdmitCardRecord {
  return {
    id: CARD_ID,
    exam_id: EXAM_ID,
    student_id: STUDENT_ID,
    student_name: "Ali Raza",
    admission_number: "ADM-001",
    section_id: SECTION_ID,
    section_name: "A",
    admit_card_no: "1A2B3C4D-ADM-001",
    file_id: FILE_ID,
    status: "issued",
    issued_at: "2026-10-01T09:00:00Z",
    revoked_reason: null,
    created_at: "2026-10-01T08:59:00Z",
    updated_at: "2026-10-01T09:00:00Z",
    ...overrides,
  };
}

/** One cursor page of `cards`, the last one unless `nextCursor` says otherwise. */
export function admitCardPage(
  cards: AdmitCardRecord[],
  nextCursor: string | null = null,
): Page<AdmitCardRecord> {
  return {
    items: cards,
    pagination: { next_cursor: nextCursor, previous_cursor: null, page_size: 25 },
  };
}
