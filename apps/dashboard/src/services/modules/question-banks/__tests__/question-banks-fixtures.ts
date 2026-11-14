import type { Page } from "@schoolhub/types";

import type { QuestionBankRecord, QuestionRecord } from "@/services";

// UUID-shaped: the URL and the bank route drop an id that isn't one.
export const BANK_ID = "7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
export const OTHER_BANK_ID = "8b2c3d4e-5f6a-4b7c-9d8e-0f1a2b3c4d5e";
export const SUBJECT_ID = "9c3d4e5f-6a7b-4c8d-ae9f-1a2b3c4d5e6f";
export const QUESTION_ID = "0d4e5f6a-7b8c-4d9e-bf0a-2b3c4d5e6f70";
export const AI_QUESTION_ID = "1e5f6a7b-8c9d-4e0f-8a1b-3c4d5e6f7081";
export const FILE_ID = "2f6a7b8c-9d0e-4f1a-9b2c-4d5e6f708192";

const STAMP = "2026-10-01T00:00:00Z";

/** A Mathematics bank for every level, with three questions. */
export function bankRecord(overrides: Partial<QuestionBankRecord> = {}): QuestionBankRecord {
  return {
    id: BANK_ID,
    subject_id: SUBJECT_ID,
    subject_name: "Mathematics",
    class_id: null,
    class_name: null,
    name: "Algebra basics",
    description: null,
    status: "active",
    question_count: 3,
    created_at: STAMP,
    updated_at: STAMP,
    ...overrides,
  };
}

export function bankPage(items: QuestionBankRecord[]): Page<QuestionBankRecord> {
  return {
    items,
    pagination: { page: 1, page_size: 10, total_count: items.length, total_pages: 1 },
  };
}

/** A teacher's own short-answer question: approved on save, with no approver. */
export function questionRecord(overrides: Partial<QuestionRecord> = {}): QuestionRecord {
  return {
    id: QUESTION_ID,
    question_bank_id: BANK_ID,
    question_text: "Solve 2x + 3 = 7.",
    question_type: "short_answer",
    difficulty: "easy",
    default_marks: "2.00",
    options: null,
    answer_key: "x = 2",
    topic: "Linear equations",
    source: "manual",
    is_approved: true,
    approved_by: null,
    approved_by_name: null,
    usage_count: 0,
    created_at: STAMP,
    updated_at: STAMP,
    ...overrides,
  };
}

/** An AI draft nobody has approved: what Approve is for. */
export function aiDraftRecord(overrides: Partial<QuestionRecord> = {}): QuestionRecord {
  return questionRecord({
    id: AI_QUESTION_ID,
    question_text: "Which of these is a prime number?",
    question_type: "mcq",
    difficulty: "medium",
    options: ["4", "6", "7", "9"],
    answer_key: "7",
    source: "ai_generated",
    is_approved: false,
    ...overrides,
  });
}

export function questionPage(
  items: QuestionRecord[],
  nextCursor: string | null = null,
): Page<QuestionRecord> {
  return {
    items,
    pagination: { page_size: 25, next_cursor: nextCursor, previous_cursor: null },
  };
}
