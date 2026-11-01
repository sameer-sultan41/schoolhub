import { ApiError } from "@schoolhub/api-client";
import type { ApiMeta } from "@schoolhub/types";

import { copyMappedFields } from "@/lib/helpers";
import type { ExamStatus } from "@/services/modules/exams/exams-type";
import {
  CONFLICT_SEVERITIES,
  PUBLISHABLE_EXAM_STATUSES,
  SHORT_TIME_LENGTH,
  SITTING_BODY_FIELDS,
  SITTING_STATUS_SCHEDULED,
} from "./exam-schedules-constant";
import type { SittingFormValues } from "./exam-schedules.schema";
import type { ExamConflict, SittingDay, SittingInput, SittingRecord } from "./exam-schedules-type";

/** The exam-schedules module's pure helpers: plain data in, plain data out. */

/** `SittingInput` -> the API body; `null` is kept (it clears a room or an invigilator). */
export function toSittingBody(input: Partial<SittingInput>): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  copyMappedFields(input, SITTING_BODY_FIELDS, (value) => value !== undefined, body);
  return body;
}

/** `HH:MM:SS` -> `HH:MM`, the form's and the table's shape. */
export function toShortTime(time: string): string {
  return time.slice(0, SHORT_TIME_LENGTH);
}

/** A finding as the schedule treats it: an unknown severity counts as hard. */
function normalizeConflict(raw: ExamConflict): ExamConflict {
  return CONFLICT_SEVERITIES.includes(raw.severity) ? raw : { ...raw, severity: "hard" };
}

/** A conflict list from a loosely typed place (`meta`, an error's `meta`), in the server's order.
 * A missing or malformed list is no findings, never a crash. */
function readConflictList(value: unknown): ExamConflict[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (item): item is ExamConflict =>
        typeof item === "object" &&
        item !== null &&
        Array.isArray((item as Partial<ExamConflict>).schedule_ids),
    )
    .map(normalizeConflict);
}

/** A sitting write's `meta.conflicts`: the envelope's `meta` is not generated, so this is where
 * the generated `ExamConflict` shape is applied to it. */
export function conflictsFromMeta(meta: ApiMeta | undefined): ExamConflict[] {
  return readConflictList(meta?.conflicts);
}

/** A refused `:publish-schedule`'s findings, carried in the error's `meta` (never `details`,
 * which flattens them and would lose all but one `schedule_ids` entry). */
export function conflictsFromError(error: unknown): ExamConflict[] {
  return error instanceof ApiError ? readConflictList(error.meta.conflicts) : [];
}

export function isHardConflict(conflict: ExamConflict): boolean {
  return conflict.severity === "hard";
}

export function hardConflictCount(conflicts: readonly ExamConflict[]): number {
  return conflicts.filter(isHardConflict).length;
}

/** The server's order (hard first), kept: a stable partition for a list from anywhere else. */
export function hardFirst(conflicts: readonly ExamConflict[]): ExamConflict[] {
  return [...conflicts.filter(isHardConflict), ...conflicts.filter((c) => !isHardConflict(c))];
}

/** Every finding filed under each sitting it names, so each side of a clash can show it. */
export function conflictsBySitting(
  conflicts: readonly ExamConflict[],
): Map<string, ExamConflict[]> {
  const index = new Map<string, ExamConflict[]>();
  for (const conflict of conflicts) {
    for (const sittingId of conflict.schedule_ids) {
      index.set(sittingId, [...(index.get(sittingId) ?? []), conflict]);
    }
  }
  return index;
}

/** The worst severity among a sitting's findings, or `null` when none names it. */
export function worstSeverity(conflicts: readonly ExamConflict[] | undefined) {
  if (!conflicts || conflicts.length === 0) return null;
  return conflicts.some(isHardConflict) ? "hard" : "soft";
}

function compareSittings(a: SittingRecord, b: SittingRecord): number {
  return (
    a.exam_date.localeCompare(b.exam_date) ||
    a.start_time.localeCompare(b.start_time) ||
    a.class_name.localeCompare(b.class_name) ||
    a.section_name.localeCompare(b.section_name) ||
    a.subject_name.localeCompare(b.subject_name)
  );
}

/** The sittings grouped by date, then ordered by start time within the day. */
export function groupByDate(rows: readonly SittingRecord[]): SittingDay[] {
  const days = new Map<string, SittingDay>();
  for (const row of [...rows].sort(compareSittings)) {
    const day = days.get(row.exam_date) ?? { date: row.exam_date, sittings: [] };
    day.sittings.push(row);
    days.set(row.exam_date, day);
  }
  return [...days.values()];
}

/** A `YYYY-MM-DD` date as the viewer's own long date, read as that calendar day (not as a UTC
 * instant, which would slip a day west of Greenwich); the raw value when it isn't a date. */
export function formatSittingDate(value: string, locale: string): string {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return value;
  return new Intl.DateTimeFormat(locale, { dateStyle: "full" }).format(
    new Date(year, month - 1, day),
  );
}

/** Only a sitting still `scheduled` is rescheduled, cancelled or deleted (`assert_schedule_is_editable`). */
export function isSittingOpen(sitting: SittingRecord): boolean {
  return (sitting.status ?? SITTING_STATUS_SCHEDULED) === SITTING_STATUS_SCHEDULED;
}

export function isSchedulePublishable(status: ExamStatus): boolean {
  return PUBLISHABLE_EXAM_STATUSES.includes(status);
}

export function defaultSittingFormValues(): SittingFormValues {
  return {
    exam_subject_id: "",
    section_id: "",
    exam_date: "",
    start_time: "",
    end_time: "",
    room_id: "",
    invigilator_staff_id: "",
  };
}

export function recordToSittingFormValues(record: SittingRecord): SittingFormValues {
  return {
    exam_subject_id: record.exam_subject_id,
    section_id: record.section_id,
    exam_date: record.exam_date,
    start_time: toShortTime(record.start_time),
    end_time: toShortTime(record.end_time),
    room_id: record.room_id ?? "",
    invigilator_staff_id: record.invigilator_staff_id ?? "",
  };
}

/** Form values -> the service input. A blank room or invigilator is `null`, which clears it. */
export function buildSittingInput(values: SittingFormValues): SittingInput {
  return {
    examSubjectId: values.exam_subject_id,
    sectionId: values.section_id,
    examDate: values.exam_date,
    startTime: values.start_time,
    endTime: values.end_time,
    roomId: values.room_id === "" ? null : values.room_id,
    invigilatorStaffId: values.invigilator_staff_id === "" ? null : values.invigilator_staff_id,
  };
}
