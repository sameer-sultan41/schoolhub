import { copyMappedFields } from "@/lib/helpers";
import type { ExamStatus } from "@/services/modules/exams/exams-type";
import {
  MARKS_ENTRY_EXAM_STATUS,
  MARKS_ENTRY_FIELDS,
  MARKS_MAX_DECIMAL_PLACES,
  MARKS_MAX_INTEGER_DIGITS,
  MARKS_UNWRITABLE_REASONS,
} from "./marks-constant";
import type {
  BulkMarksEntryInput,
  MarksGridMeta,
  MarksProgressRow,
  MarksUnwritableReason,
} from "./marks-type";

/** The marks module's pure helpers. */

function isUnwritableReason(value: unknown): value is MarksUnwritableReason {
  return MARKS_UNWRITABLE_REASONS.includes(value as MarksUnwritableReason);
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

/** The grid's `meta` as the screen reads it. A missing or malformed `writable` reads as
 * read-only, so a bad answer never offers an edit. */
export function toMarksGridMeta(meta: Record<string, unknown> | undefined): MarksGridMeta {
  const raw = meta ?? {};
  const subject = asRecord(raw.exam_subject);
  return {
    examSubject: {
      maxMarks: stringOrNull(subject.max_marks) ?? "",
      passMarks: stringOrNull(subject.pass_marks) ?? "",
      hasPractical: subject.has_practical === true,
      practicalMaxMarks: stringOrNull(subject.practical_max_marks),
    },
    writable: raw.writable === true,
    unwritableReason: isUnwritableReason(raw.unwritable_reason) ? raw.unwritable_reason : null,
    unwritableMessage: stringOrNull(raw.unwritable_message),
  };
}

/** The `:bulk-entry` body: every entry with every field, a null clearing its column. */
export function toBulkMarksEntryBody(input: BulkMarksEntryInput): Record<string, unknown> {
  return {
    exam_subject_id: input.examSubjectId,
    section_id: input.sectionId,
    entries: input.entries.map((entry) => {
      const row: Record<string, unknown> = {};
      copyMappedFields(entry, MARKS_ENTRY_FIELDS, () => true, row);
      return row;
    }),
  };
}

/** A wire decimal (`"45.50"`) as the input shows it (`"45.5"`); null is blank. */
export function toMarkInput(value: string | null): string {
  if (value === null) return "";
  return value.includes(".") ? value.replace(/\.?0+$/, "") : value;
}

/** A non-negative number the serializer's decimal field accepts. */
const INTEGER_DIGITS = String(MARKS_MAX_INTEGER_DIGITS);
const DECIMAL_PLACES = String(MARKS_MAX_DECIMAL_PLACES);
const MARK_PATTERN = new RegExp(`^\\d{1,${INTEGER_DIGITS}}(\\.\\d{1,${DECIMAL_PLACES}})?$`);

/** What is wrong with a typed mark: `invalid` (not a number of at most four digits and two
 * decimals, which the server refuses as a 400), `aboveMax` (over `max`, which it refuses in
 * `meta.rows`), or null. */
export function markIssue(value: string, max: string | null): "invalid" | "aboveMax" | null {
  if (value === "") return null;
  if (!MARK_PATTERN.test(value)) return "invalid";
  if (max !== null && max !== "" && Number(value) > Number(max)) return "aboveMax";
  return null;
}

/** Where one (exam-subject, section) stands: locked, every student submitted, some entered, or
 * none yet. */
export type MarksProgressState = "locked" | "submitted" | "inProgress" | "notStarted";

export function progressState(row: MarksProgressRow): MarksProgressState {
  if (row.is_locked) return "locked";
  if (row.expected > 0 && row.submitted >= row.expected) return "submitted";
  return row.entered > 0 ? "inProgress" : "notStarted";
}

/** The exam takes marks while a subject is locked: that subject must be unlocked before anyone can
 * correct it (L4). A send-back is one way to get here; locking one subject while others are still
 * entered is another. */
export function needsUnlockToEdit(
  examStatus: ExamStatus,
  rows: readonly MarksProgressRow[],
): boolean {
  return examStatus === MARKS_ENTRY_EXAM_STATUS && rows.some((row) => row.is_locked);
}
