import { FILTER_ALL } from "@/lib/constants";
import { copyMappedFields } from "@/lib/helpers";
import { toShortTime } from "@/services/modules/periods/periods-helper";
import { shiftIsoDate } from "@/services/modules/student-attendance/student-attendance-helper";
import {
  MARK_STAFF_BODY_FIELDS,
  MARKABLE_STAFF_STATUSES,
  STAFF_ATTENDANCE_QUERY_FIELDS,
  STAFF_HISTORY_DEFAULT_RANGE_DAYS,
  STAFF_STATUS_ABSENT,
} from "./staff-attendance-constant";
import type {
  MarkableStaffStatus,
  MarkStaffAttendanceInput,
  StaffAttendancePageQuery,
  StaffAttendanceRecord,
  StaffAttendanceStatus,
  StaffRegisterEntry,
  StaffRowDraft,
} from "./staff-attendance-type";

/** The staff-attendance module's pure helpers. */

export function toStaffAttendanceQueryParams(
  query: StaffAttendancePageQuery,
): Record<string, string | number | boolean | undefined> {
  const params: Record<string, unknown> = { page_size: query.pageSize };
  copyMappedFields(
    query,
    STAFF_ATTENDANCE_QUERY_FIELDS,
    (value) => value !== undefined && value !== "",
    params,
  );
  return params as Record<string, string | number | boolean | undefined>;
}

/** The `POST /staff-attendance` body. Every key is sent, a blank one as `null`: the server
 * upserts the whole day, so a key left out would clear it anyway. */
export function toMarkStaffBody(input: MarkStaffAttendanceInput): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  copyMappedFields(input, MARK_STAFF_BODY_FIELDS, () => true, body);
  return body;
}

/** Whether the staff register may set `status` (not `on_leave`, not `holiday`). */
export function isMarkableStaffStatus(status: string): status is MarkableStaffStatus {
  return (MARKABLE_STAFF_STATUSES as readonly string[]).includes(status);
}

/** The history's default window: the last `STAFF_HISTORY_DEFAULT_RANGE_DAYS` days, `today`
 * included. */
export function defaultStaffHistoryRange(today: string): { from: string; to: string } {
  return { from: shiftIsoDate(today, 1 - STAFF_HISTORY_DEFAULT_RANGE_DAYS), to: today };
}

/** The status filter's URL value as the list's `status`; `all` is no filter. */
export function staffStatusFilterToStatus(value: string): StaffAttendanceStatus | undefined {
  return value === FILTER_ALL ? undefined : (value as StaffAttendanceStatus);
}

/** A row's choices as the record holds them; an unmarked row starts blank. */
export function staffDraftFromRecord(record: StaffAttendanceRecord | null): StaffRowDraft {
  return {
    status: record && isMarkableStaffStatus(record.status) ? record.status : "",
    checkInTime: record?.check_in_time ? toShortTime(record.check_in_time) : "",
    remarks: record?.remarks ?? "",
  };
}

/** Whether the row has something to save: a status picked, and a value that differs from the
 * record (any status, for a row not yet marked). */
export function isStaffDraftChanged(
  draft: StaffRowDraft,
  record: StaffAttendanceRecord | null,
): boolean {
  if (draft.status === "") return false;
  if (!record) return true;
  const saved = staffDraftFromRecord(record);
  return (
    draft.status !== record.status ||
    draft.checkInTime !== saved.checkInTime ||
    draft.remarks.trim() !== saved.remarks.trim()
  );
}

const DRAFT_FIELDS: readonly (keyof StaffRowDraft)[] = ["status", "checkInTime", "remarks"];

/** Whether two drafts hold the same values. */
export function isSameStaffDraft(a: StaffRowDraft, b: StaffRowDraft): boolean {
  return DRAFT_FIELDS.every((field) => a[field] === b[field]);
}

/**
 * A row's draft once its record changed from `before` to `after` (a save, a check-out, a reload):
 * a field the viewer hadn't edited takes the record's new value, and an unsaved edit stays.
 */
export function rebaseStaffDraft(
  draft: StaffRowDraft,
  before: StaffRowDraft,
  after: StaffRowDraft,
): StaffRowDraft {
  const pick = <K extends keyof StaffRowDraft>(field: K) =>
    draft[field] === before[field] ? after[field] : draft[field];
  return { status: pick("status"), checkInTime: pick("checkInTime"), remarks: pick("remarks") };
}

/** Whether saving the draft would clear a saved time: an absent day sends none. */
export function clearsSavedTimes(
  draft: StaffRowDraft,
  record: StaffAttendanceRecord | null,
): boolean {
  return (
    draft.status === STAFF_STATUS_ABSENT && !!(record?.check_in_time || record?.check_out_time)
  );
}

/**
 * What a row's Save sends. The saved check-out is sent back unchanged, since the upsert would
 * otherwise clear it, and so is the saved check-in while its `HH:MM` is untouched, so a self
 * check-in keeps its seconds; an absent day carries no times at all.
 */
export function toMarkStaffInput(
  entry: StaffRegisterEntry,
  date: string,
  draft: StaffRowDraft & { status: MarkableStaffStatus },
): MarkStaffAttendanceInput {
  const absent = draft.status === STAFF_STATUS_ABSENT;
  const savedCheckIn = entry.record?.check_in_time ?? null;
  let checkInTime = draft.checkInTime || null;
  if (savedCheckIn !== null && draft.checkInTime === toShortTime(savedCheckIn)) {
    checkInTime = savedCheckIn;
  }
  return {
    staffId: entry.staff_id,
    attendanceDate: date,
    status: draft.status,
    checkInTime: absent ? null : checkInTime,
    checkOutTime: absent ? null : (entry.record?.check_out_time ?? null),
    remarks: draft.remarks.trim() || null,
  };
}

/** The register with one staff member's record replaced by the one just written. */
export function withSavedStaffRecord(
  entries: readonly StaffRegisterEntry[],
  record: StaffAttendanceRecord,
): StaffRegisterEntry[] {
  return entries.map((entry) =>
    entry.staff_id === record.staff_id ? { ...entry, record } : entry,
  );
}

/** Whether Check out is offered: checked in, not yet checked out, and still unlocked. */
export function canCheckOut(record: StaffAttendanceRecord | null): record is StaffAttendanceRecord {
  return record !== null && !record.is_locked && !!record.check_in_time && !record.check_out_time;
}
