import { copyMappedFields } from "@/lib/helpers";
import {
  DATETIME_LOCAL_LENGTH,
  DEFAULT_SUBJECT_WEIGHTAGE,
  EXAM_SUBJECTS_BODY_FIELDS,
} from "./exam-subjects-constant";
import type { ExamSubjectFormValues } from "./exam-subjects.schema";
import type { ExamSubjectGroup, ExamSubjectInput, ExamSubjectRecord } from "./exam-subjects-type";

/** The exam-subjects module's pure helpers: plain data in, plain data out. */

export function toExamSubjectBody(input: Partial<ExamSubjectInput>): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  copyMappedFields(input, EXAM_SUBJECTS_BODY_FIELDS, (value) => value !== undefined, body);
  return body;
}

function blankToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/** An API timestamp -> a `datetime-local` input's value, in the viewer's own time zone. */
export function isoToLocalInput(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, DATETIME_LOCAL_LENGTH);
}

/** A `datetime-local` value (local time) -> the API's timestamp; blank clears it. */
export function localInputToIso(value: string): string | null {
  if (value === "") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function defaultExamSubjectFormValues(): ExamSubjectFormValues {
  return {
    class_id: "",
    subject_id: "",
    max_marks: "",
    pass_marks: "",
    has_practical: false,
    practical_max_marks: "",
    practical_pass_marks: "",
    subject_weightage_percent: DEFAULT_SUBJECT_WEIGHTAGE,
    marks_entry_opens_at: "",
    marks_entry_closes_at: "",
  };
}

export function recordToExamSubjectFormValues(record: ExamSubjectRecord): ExamSubjectFormValues {
  return {
    class_id: record.class_id,
    subject_id: record.subject_id,
    max_marks: record.max_marks,
    pass_marks: record.pass_marks,
    has_practical: record.has_practical ?? false,
    practical_max_marks: record.practical_max_marks ?? "",
    practical_pass_marks: record.practical_pass_marks ?? "",
    subject_weightage_percent: record.subject_weightage_percent ?? DEFAULT_SUBJECT_WEIGHTAGE,
    marks_entry_opens_at: isoToLocalInput(record.marks_entry_opens_at),
    marks_entry_closes_at: isoToLocalInput(record.marks_entry_closes_at),
  };
}

/** Form values -> the service input. A subject with no practical part sends no practical marks,
 * so a pair left in the form from an earlier toggle is cleared rather than kept (the model's
 * CHECK ties them to `has_practical`). */
export function buildExamSubjectInput(
  examId: string,
  values: ExamSubjectFormValues,
): ExamSubjectInput {
  return {
    examId,
    classId: values.class_id,
    subjectId: values.subject_id,
    maxMarks: values.max_marks.trim(),
    passMarks: values.pass_marks.trim(),
    hasPractical: values.has_practical,
    practicalMaxMarks: values.has_practical ? blankToNull(values.practical_max_marks) : null,
    practicalPassMarks: values.has_practical ? blankToNull(values.practical_pass_marks) : null,
    subjectWeightagePercent: values.subject_weightage_percent.trim(),
    marksEntryOpensAt: localInputToIso(values.marks_entry_opens_at),
    marksEntryClosesAt: localInputToIso(values.marks_entry_closes_at),
  };
}

/** The exam's subjects grouped by class, in the order the API sends them (class, then subject),
 * so a class's rows are adjacent and one group is one class. */
export function groupByClass(rows: readonly ExamSubjectRecord[]): ExamSubjectGroup[] {
  const groups = new Map<string, ExamSubjectGroup>();
  for (const row of rows) {
    const group = groups.get(row.class_id) ?? {
      classId: row.class_id,
      className: row.class_name,
      rows: [],
    };
    group.rows.push(row);
    groups.set(row.class_id, group);
  }
  return [...groups.values()];
}

/** An API timestamp as the viewer's own date and time ("Aug 1, 2026, 9:00 AM"); the raw value
 * when it isn't a date. */
export function formatDateTime(value: string, locale: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(date);
}
