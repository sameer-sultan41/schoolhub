import type { ApiSchemas } from "@schoolhub/api-client";

/** The generated wire shapes (ADR-0017). */
export type MarksRecord = ApiSchemas["Marks"];
export type MarksGridEntry = ApiSchemas["MarksGridEntry"];
export type MarksEntryStatus = ApiSchemas["MarksEntryStatusEnum"];
export type BulkMarksEntryResult = ApiSchemas["BulkMarksEntryResult"];
export type MarksLockResult = ApiSchemas["MarksLockResult"];
export type MarksUnlockResult = ApiSchemas["MarksUnlockResult"];
export type MarksProgressRow = ApiSchemas["MarksProgressRow"];

/** Why a grid is read-only (`meta.unwritable_reason`, `services.marks_grid_writability`). */
export type MarksUnwritableReason =
  "exam_status" | "window_not_open" | "window_closed" | "locked" | "no_permission";

/** The grid's `meta`. The API leaves it untyped (as attendance's `RegisterMeta`), so this follows
 * `MarksViewSet.grid`. Decimals stay strings, as the API sends them. */
export interface MarksGridMeta {
  examSubject: {
    maxMarks: string;
    passMarks: string;
    hasPractical: boolean;
    practicalMaxMarks: string | null;
  };
  writable: boolean;
  unwritableReason: MarksUnwritableReason | null;
  unwritableMessage: string | null;
}

export interface MarksGridQuery {
  examSubjectId: string;
  sectionId: string;
}

export interface MarksGrid {
  entries: MarksGridEntry[];
  meta: MarksGridMeta;
}

/** One student's row as `:bulk-entry` takes it. A blank mark is `null`. */
export interface MarksEntryInput {
  studentId: string;
  theoryMarks: string | null;
  practicalMarks: string | null;
  isAbsent: boolean;
  isExempt: boolean;
  status: MarksEntryStatus;
  remarks: string | null;
}

export interface BulkMarksEntryInput {
  examSubjectId: string;
  sectionId: string;
  entries: MarksEntryInput[];
}
