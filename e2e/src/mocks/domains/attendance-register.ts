import type { ApiErrorDetail } from "@schoolhub/types";
import { uuid } from "@/data/factories";
import { fail, ok, paginated, type MockResponse } from "../envelope";
import { invalidCursorResponse, lockedSessionResponse } from "../list";
import type { MockModule } from "../router";
import type { CorrectionRecord } from "./attendance-approvals-store";
import {
  fieldError,
  fieldErrors,
  INVALID_UUID,
  isUuid,
  NOT_BLANK,
  NOT_NULL,
  REQUIRED,
} from "./attendance-mock-utils";
import {
  ATTENDANCE_MESSAGES,
  type AttendanceRecord,
  type AttendanceRegisterStore,
  type AttendanceStatus,
  lateAfter,
  STAFF_ATTENDANCE_STATUSES,
  STUDENT_ATTENDANCE_STATUSES,
  todayUtc,
} from "./attendance-register-store";

/** `services.ALERT_STATUSES`: a row that becomes one of these queues a guardian alert. */
const ALERT_STATUSES: readonly AttendanceStatus[] = ["absent", "late"];
/** `services.CORRECTABLE_FIELDS`. */
const CORRECTABLE_FIELDS = ["status", "check_in_time", "check_out_time", "remarks"] as const;

/** A student row as a correction's target: what `raiseCorrection` needs to know about it. */
export function studentCorrectionTarget(
  store: AttendanceRegisterStore,
  id: string,
): CorrectionTarget | undefined {
  const row = store.records.find((candidate) => candidate.id === id);
  if (!row) return undefined;
  return {
    field: "student_attendance_id",
    locked: store.isLocked(row),
    current: Object.fromEntries(CORRECTABLE_FIELDS.map((field) => [field, row[field]])),
    subject: {
      subject_type: "student",
      student_attendance_id: row.id,
      staff_attendance_id: null,
      student_id: row.student_id,
      student_name: row.student_name,
      staff_name: null,
      employee_number: null,
      subject_user_id: null,
      attendance_date: row.attendance_date,
      period_name: row.period_name,
    },
  };
}

/** The correction serializer's and `request_correction`'s sentences, copied verbatim (L5). */
export const CORRECTION_MESSAGES = {
  oneTarget: "Name exactly one of student_attendance_id or staff_attendance_id.",
  unknownStatus: "Not a known attendance status.",
  onLeave: "'on_leave' is set by an approved leave request, not by a correction.",
  checkOutBeforeCheckIn: "Check-out must be later than check-in (§11).",
} as const;

/** A `DomainRuleViolation` on one field: a 422 whose message is that field's issue. */
export function refusal(field: string, issue: string): MockResponse {
  return fail(422, issue, { code: "domain_rule_violation", details: [{ field, issue }] });
}

interface RowIssue {
  student_id: string;
  issue: string;
}

/** The whole-submission refusal: the `entries` sentence, each refused row under `error.meta`. */
function rowsRefusal(message: string, rows: RowIssue[]): MockResponse {
  const refused = fail(422, message, {
    code: "domain_rule_violation",
    details: [{ field: "entries", issue: message }],
  });
  return { ...refused, body: { error: { ...refused.body.error, meta: { rows } } } };
}

/** `assert_register_period`'s shape checks: the mode's period rule, then the timetable flag. */
function modeRefusal(
  store: AttendanceRegisterStore,
  periodId: string | null,
): MockResponse | undefined {
  if (store.mode === "daily" && periodId) {
    return refusal("period_id", ATTENDANCE_MESSAGES.dailyWithPeriod);
  }
  if (store.mode === "period" && !periodId) {
    return refusal("period_id", ATTENDANCE_MESSAGES.periodWithout);
  }
  if (store.mode === "period" && !store.timetableEnabled) {
    return refusal("period_id", ATTENDANCE_MESSAGES.timetableRequired);
  }
  return undefined;
}

export interface DateIssue {
  reason: "future" | "holiday" | "non_working_day";
  holidayName: string | null;
}

/** The school calendar a date is checked against: holidays by date, Monday = 0 working days. */
export type SchoolCalendar = Pick<AttendanceRegisterStore, "holidays" | "workingDays">;

/** Python's `date.weekday()`: Monday = 0, where JavaScript's `getUTCDay()` has Sunday = 0. */
function pythonWeekday(isoDate: string): number {
  return (new Date(`${isoDate}T00:00:00Z`).getUTCDay() + 6) % 7;
}

/** `unmarkable_date_issue`, in the server's order: future, holiday, then a non-working day. */
export function dateIssue(calendar: SchoolCalendar, date: string): DateIssue | null {
  if (date > todayUtc()) return { reason: "future", holidayName: null };
  const holidayName = calendar.holidays[date];
  if (holidayName) return { reason: "holiday", holidayName };
  if (!calendar.workingDays.includes(pythonWeekday(date))) {
    return { reason: "non_working_day", holidayName: null };
  }
  return null;
}

/** `assert_markable_date`'s sentence for each reason. */
export function dateRefusal(date: string, issue: DateIssue): MockResponse {
  const messages: Record<DateIssue["reason"], string> = {
    future: ATTENDANCE_MESSAGES.future,
    holiday: `${date} is ${issue.holidayName}; the school is closed.`,
    non_working_day: `${date} is not a working day for this school.`,
  };
  return refusal("attendance_date", messages[issue.reason]);
}

/** `calendar.late_minutes`: minutes after the day's start (`lateAfter`). */
function lateMinutes(store: AttendanceRegisterStore, checkIn: string): number {
  return lateAfter(store.dayStart, checkIn, store.graceMinutes);
}

/** `HH:MM`, what a `<input type="time">` sends. */
const SHORT_TIME_LENGTH = 5;

/** DRF's `TimeField` answers `HH:MM:SS`. */
export function asTime(value: unknown): string | null {
  if (typeof value !== "string" || value === "") return null;
  return value.length === SHORT_TIME_LENGTH ? `${value}:00` : value;
}

/** A time DRF's `TimeField` parses: `HH:MM` or `HH:MM:SS`. */
export function isTime(value: unknown): boolean {
  return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(value);
}

/** DRF's `TimeField.default_error_messages["invalid"]` for the formats this API accepts; the
 * microseconds placeholder is DRF's own six `u`s, built so the spell check reads no word. */
export const TIME_FORMAT_ISSUE =
  "Time has wrong format. Use one of these formats instead: " + `hh:mm[:ss[.${"u".repeat(6)}]].`;

/** `services.CORRECTABLE_FIELDS` (student rows) and `STAFF_CORRECTABLE_FIELDS` (staff rows). */
const STUDENT_CORRECTABLE = CORRECTABLE_FIELDS;
const STAFF_CORRECTABLE = ["status", "check_in_time", "check_out_time"] as const;
/** `AttendanceCorrection.reason`'s `max_length`. */
const REASON_MAX_LENGTH = 500;
const TARGET_FIELDS = ["student_attendance_id", "staff_attendance_id"] as const;

/** The row a correction names, as the view resolves it through the caller's scope. */
export interface CorrectionTarget {
  field: "student_attendance_id" | "staff_attendance_id";
  locked: boolean;
  /** The row's current values, keyed by correctable field, times as `HH:MM:SS`. */
  current: Record<string, unknown>;
  /** The read fields the correction carries for its target (the other kind's are null). */
  subject: Pick<
    CorrectionRecord,
    | "subject_type"
    | "student_attendance_id"
    | "staff_attendance_id"
    | "student_id"
    | "student_name"
    | "staff_name"
    | "employee_number"
    | "subject_user_id"
    | "attendance_date"
    | "period_name"
  >;
}

export interface CorrectionRequester {
  id: string;
  name: string | null;
}

/**
 * `AttendanceCorrectionSerializer`'s field stage: every field's error together, in the
 * serializer's field order (the two target ids, `new_values`, `reason`). Answers the normalised
 * proposal and reason, or the 400.
 */
function correctionFields(
  body: CorrectionBody,
): { values: Record<string, unknown>; reason: string } | MockResponse {
  const details: ApiErrorDetail[] = [];
  for (const field of TARGET_FIELDS) {
    const id = body[field];
    if (id !== undefined && id !== null && !isUuid(id)) {
      details.push({ field, issue: INVALID_UUID });
    }
  }

  const raw = body.new_values;
  const values: Record<string, unknown> = {};
  if (raw === undefined) details.push({ field: "new_values", issue: REQUIRED });
  else if (raw === null) details.push({ field: "new_values", issue: NOT_NULL });
  else if (typeof raw !== "object" || Array.isArray(raw)) {
    details.push({ field: "new_values", issue: "Expected an object of field → new value." });
  } else {
    Object.assign(values, raw);
    // `validate_new_values` round-trips each time through a `TimeField`: the first bad one
    // raises.
    const badTime = ["check_in_time", "check_out_time"].find((field) => {
      const value = values[field];
      if (value === undefined || value === null) return false;
      if (!isTime(value)) return true;
      values[field] = asTime(value);
      return false;
    });
    if (badTime) details.push({ field: "new_values", issue: TIME_FORMAT_ISSUE });
  }

  // A `CharField`: required, not null, trimmed, then not blank and at most 500 characters.
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (body.reason === undefined) details.push({ field: "reason", issue: REQUIRED });
  else if (body.reason === null) details.push({ field: "reason", issue: NOT_NULL });
  else if (reason === "") details.push({ field: "reason", issue: NOT_BLANK });
  else if (reason.length > REASON_MAX_LENGTH) {
    details.push({
      field: "reason",
      issue: `Ensure this field has no more than ${REASON_MAX_LENGTH} characters.`,
    });
  }

  return details.length > 0 ? fieldErrors(details) : { values, reason };
}

/**
 * `POST /attendance-corrections` in the server's order: the serializer's fields (well-formed
 * target ids, `new_values` an object with valid times, a `reason`; 400s together), its
 * `validate` (exactly one target, then only the fields and statuses that target's kind allows;
 * 400s), the view's scoped lookup (404), then `request_correction` (still editable, no field
 * named, unchanged values, and for a staff row check-out after check-in; 422s), each with the
 * server's sentence. `resolve` answers for the targets the calling stub holds.
 */
export function raiseCorrection(
  body: CorrectionBody,
  resolve: (field: CorrectionTarget["field"], id: string) => CorrectionTarget | undefined,
  requester: CorrectionRequester,
  onCreate?: (correction: CorrectionRecord) => void,
): MockResponse {
  const accepted = correctionFields(body);
  if (!("values" in accepted)) return accepted;
  const { values, reason } = accepted;

  const named = TARGET_FIELDS.filter((field) => body[field] !== undefined && body[field] !== null);
  const [targetField] = named;
  if (named.length !== 1 || !targetField) {
    return fieldError("non_field_errors", CORRECTION_MESSAGES.oneTarget);
  }
  const isStaff = targetField === "staff_attendance_id";
  const fields: readonly string[] = isStaff ? STAFF_CORRECTABLE : STUDENT_CORRECTABLE;
  const statuses: readonly string[] = isStaff
    ? STAFF_ATTENDANCE_STATUSES
    : STUDENT_ATTENDANCE_STATUSES;
  const unknown = Object.keys(values)
    .filter((field) => !fields.includes(field))
    .sort();
  if (unknown.length > 0) {
    return fieldError(
      "new_values",
      `Not correctable: ${unknown.join(", ")}. Allowed: ${fields.join(", ")}.`,
    );
  }
  if ("status" in values) {
    if (!statuses.includes(String(values["status"]))) {
      return fieldError("new_values.status", CORRECTION_MESSAGES.unknownStatus);
    }
    if (values["status"] === "on_leave") {
      return fieldError("new_values.status", CORRECTION_MESSAGES.onLeave);
    }
  }

  // A string by now: the field stage refused any id that is not a UUID.
  const targetId = body[targetField];
  const target = typeof targetId === "string" ? resolve(targetField, targetId) : undefined;
  if (!target) return fail(404, "Not found.");
  if (!target.locked) return refusal(target.field, ATTENDANCE_MESSAGES.correctionNotLocked);
  const proposed = Object.fromEntries(
    fields.filter((field) => field in values).map((field) => [field, values[field]]),
  );
  if (Object.keys(proposed).length === 0) {
    return refusal("new_values", `Name at least one of: ${fields.join(", ")}.`);
  }
  const old = Object.fromEntries(
    Object.keys(proposed).map((field) => [field, target.current[field] ?? null]),
  );
  if (JSON.stringify(old) === JSON.stringify(proposed)) {
    return refusal("new_values", ATTENDANCE_MESSAGES.correctionUnchanged);
  }
  if (isStaff) {
    // `proposed.get(field, row's value)`: a time proposed as null stays null.
    const asEnded = (field: string) =>
      (field in proposed ? proposed[field] : target.current[field]) as string | null;
    const checkIn = asEnded("check_in_time");
    const checkOut = asEnded("check_out_time");
    if (checkIn && checkOut && checkOut <= checkIn) {
      return refusal("new_values", CORRECTION_MESSAGES.checkOutBeforeCheckIn);
    }
  }

  const now = new Date().toISOString();
  const correction: CorrectionRecord = {
    id: uuid(),
    ...target.subject,
    requested_by: requester.id,
    requested_by_name: requester.name,
    old_values: old,
    new_values: proposed,
    reason,
    status: "pending",
    reviewed_by: null,
    reviewed_by_name: null,
    reviewed_at: null,
    review_note: null,
    created_at: now,
    updated_at: now,
  };
  onCreate?.(correction);
  return ok(structuredClone(correction), { status: 201 });
}

interface BulkMarkEntry {
  student_id: string;
  status: AttendanceStatus;
  check_in_time?: string;
  check_out_time?: string;
  remarks?: string;
}

export interface CorrectionBody {
  student_attendance_id?: unknown;
  staff_attendance_id?: unknown;
  new_values?: unknown;
  reason?: unknown;
}

interface BulkMarkBody {
  section_id?: string;
  attendance_date?: string;
  period_id?: string | null;
  entries?: BulkMarkEntry[];
}

/**
 * `/student-attendance` (`register`, `my-registers`, `:bulk-mark`, the cursor list),
 * `/attendance-corrections` (create) and `/attendance-settings`, in daily mode.
 *
 * `:bulk-mark` runs the service's checks in the service's order: session writable, a markable
 * date, the period's shape for the mode (422 on `period_id`), no empty register, then the
 * first refusal (duplicate, not enrolled, `on_leave`) with `error.meta.rows`, then a 409 for an
 * existing locked row, then the on-leave refusal with its own sentence. The lock is per row:
 * `meta.markable` says only whether the date can be marked. A successful submission is stored
 * against its `Idempotency-Key` and replayed; a refused one stores nothing
 * (`core/idempotency`). Period mode has no lessons here (no timetable), so it lists no
 * registers; who may mark a period is proven in the Django suite.
 */
export function attendanceRegisterModule(store: AttendanceRegisterStore): MockModule {
  return (api) => {
    const replays = new Map<string, MockResponse>();

    api.get("/student-attendance/my-registers", (request) => {
      const date = request.searchParams.get("date") || todayUtc();
      const mine = store.mode === "daily" ? store.sections.filter((s) => s.classTeacher) : [];
      const registers = mine.map((section) => ({
        section_id: section.id,
        section_name: section.name,
        class_name: section.className,
        campus_id: section.campusId,
        period_id: null,
        period_name: null,
        start_time: null,
        end_time: null,
        marked_count: section.students.filter((s) => store.find(s.id, date, null)).length,
        roster_count: section.students.length,
      }));
      return ok(registers, { meta: { attendance_mode: store.mode, date } });
    });

    api.get("/student-attendance/register", (request) => {
      const params = request.searchParams;
      const section = store.sections.find((s) => s.id === params.get("section_id"));
      // A register the caller may not mark reads as missing, never forbidden.
      if (!section) return fail(404, "Not found.");
      const date = params.get("date") ?? todayUtc();
      const periodId = params.get("period_id");
      const wrongShape = modeRefusal(store, periodId);
      if (wrongShape) return wrongShape;

      const entries = section.students.map((student) => {
        const record = store.find(student.id, date, periodId);
        return {
          student_id: student.id,
          student_name: student.name,
          admission_number: student.admissionNumber,
          roll_number: student.rollNumber,
          record: record ? store.serialize(record) : null,
          on_leave: store.find(student.id, date, null)?.status === "on_leave",
        };
      });
      const issue = dateIssue(store, date);
      const closed = lockedSessionResponse([store.session], store.session.id) !== undefined;
      const reason = issue?.reason ?? (closed ? "session_closed" : null);
      return ok(entries, {
        meta: {
          attendance_mode: store.mode,
          is_locked: date < store.lockCutoff(),
          markable: reason === null,
          unmarkable_reason: reason,
          holiday_name: issue?.holidayName ?? null,
          academic_session_id: store.session.id,
        },
      });
    });

    api.post("/student-attendance:bulk-mark", (request) => {
      const key = request.headers["idempotency-key"];
      const replay = key ? replays.get(key) : undefined;
      if (replay) return replay;

      const body = (request.json() as BulkMarkBody | null) ?? {};
      const section = store.sections.find((s) => s.id === body.section_id);
      if (!section) return fail(404, "Not found.");
      const date = body.attendance_date ?? "";
      const periodId = body.period_id ?? null;
      const entries = body.entries ?? [];

      const closed = lockedSessionResponse([store.session], store.session.id);
      if (closed) return closed;
      const issue = dateIssue(store, date);
      if (issue) return dateRefusal(date, issue);
      const wrongShape = modeRefusal(store, periodId);
      if (wrongShape) return wrongShape;
      if (entries.length === 0) return refusal("entries", ATTENDANCE_MESSAGES.emptyRegister);

      const problems: RowIssue[] = [];
      const seen = new Set<string>();
      for (const entry of entries) {
        const id = entry.student_id;
        if (seen.has(id)) problems.push({ student_id: id, issue: ATTENDANCE_MESSAGES.duplicate });
        seen.add(id);
        if (!section.students.some((s) => s.id === id)) {
          problems.push({ student_id: id, issue: ATTENDANCE_MESSAGES.notEnrolled });
        }
        if (entry.status === "on_leave") {
          problems.push({ student_id: id, issue: ATTENDANCE_MESSAGES.systemOnly });
        }
      }
      if (problems.length > 0) return rowsRefusal(ATTENDANCE_MESSAGES.rowsRefused, problems);

      const existing = entries.map((entry) => store.find(entry.student_id, date, periodId));
      if (existing.some((row) => row && store.isLocked(row))) {
        return fail(409, ATTENDANCE_MESSAGES.locked);
      }
      const onLeave = entries
        .filter((_, index) => existing[index]?.status === "on_leave")
        .map((entry) => ({
          student_id: entry.student_id,
          issue: ATTENDANCE_MESSAGES.onApprovedLeave,
        }));
      if (onLeave.length > 0) return rowsRefusal(ATTENDANCE_MESSAGES.onLeaveRefused, onLeave);

      let marked = 0;
      let alerts = 0;
      // A date past the lock window (a backfill) writes its rows but alerts no one.
      const sendsAlerts = date >= store.lockCutoff();
      const rows = entries.flatMap((entry, index) => {
        // Every entry is rostered here: the not-enrolled check above refused anyone else.
        const student = section.students.find((s) => s.id === entry.student_id);
        if (!student) return [];
        let row = existing[index];
        const transitioned = row?.status !== entry.status;
        if (!row) {
          row = store.recordFor(section, student, date, { period_id: periodId });
          store.records.push(row);
          marked += 1;
        }
        const checkIn = asTime(entry.check_in_time);
        Object.assign(row, {
          section_id: section.id,
          section_name: section.name,
          status: entry.status,
          check_in_time: checkIn,
          check_out_time: asTime(entry.check_out_time),
          late_minutes: entry.status === "late" && checkIn ? lateMinutes(store, checkIn) : null,
          remarks: entry.remarks ?? null,
          marked_by: store.userId,
        });
        if (sendsAlerts && transitioned && ALERT_STATUSES.includes(entry.status)) alerts += 1;
        return [store.serialize(row)];
      });

      const response = ok(rows, {
        meta: { marked, updated: entries.length - marked, alerts_queued: alerts },
      });
      if (key) replays.set(key, response);
      return response;
    });

    api.get("/student-attendance", (request) => {
      const params = request.searchParams;
      // Every list here is one page (`next_cursor` is null), so no cursor this stub issued can
      // come back: a request carrying one gets the server's 404 "Invalid cursor".
      if (params.get("cursor")) return invalidCursorResponse();
      const sectionsOfClass = store.sections
        .filter((s) => s.classId === params.get("class_id"))
        .map((s) => s.id);
      const exact: [string, (row: AttendanceRecord) => string | null | undefined][] = [
        ["section_id", (row) => row.section_id],
        ["student_id", (row) => row.student_id],
        ["period_id", (row) => row.period_id],
        ["status", (row) => row.status],
        ["date", (row) => row.attendance_date],
      ];
      const from = params.get("date__gte");
      const to = params.get("date__lte");
      const locked = params.get("is_locked");
      const rows = store.records
        .map((row) => store.serialize(row))
        .filter(
          (row) =>
            exact.every(([name, value]) => !params.get(name) || value(row) === params.get(name)) &&
            (!params.get("class_id") || sectionsOfClass.includes(row.section_id)) &&
            (!from || row.attendance_date >= from) &&
            (!to || row.attendance_date <= to) &&
            (locked === null || String(row.is_locked) === locked),
        );
      const descending = (params.get("ordering") ?? "-attendance_date").startsWith("-");
      rows.sort((a, b) =>
        descending
          ? b.attendance_date.localeCompare(a.attendance_date)
          : a.attendance_date.localeCompare(b.attendance_date),
      );
      return paginated(rows, { page_size: Number(params.get("page_size") ?? rows.length) });
    });

    api.post("/attendance-corrections", (request) =>
      raiseCorrection(
        (request.json() as CorrectionBody | null) ?? {},
        (field, id) =>
          field === "student_attendance_id" ? studentCorrectionTarget(store, id) : undefined,
        // The mock's signed-in user has no name here; the server's is nullable.
        { id: store.userId, name: null },
      ),
    );

    const settings = () => ({
      attendance_mode: store.mode,
      lock_window_days: store.lockWindowDays,
      leave_escalation_threshold_days: store.escalationThresholdDays,
    });

    api.get("/attendance-settings", () => ok(settings()));

    api.patch("/attendance-settings", (request) => {
      const changes = (request.json() as Partial<ReturnType<typeof settings>> | null) ?? {};
      // `assert_mode_switch_allowed` refuses any PATCH naming period mode while the timetable
      // module is off, and writes nothing.
      if (changes.attendance_mode === "period" && !store.timetableEnabled) {
        return refusal("attendance_mode", ATTENDANCE_MESSAGES.timetableRequired);
      }
      if (changes.attendance_mode) store.mode = changes.attendance_mode;
      if (changes.lock_window_days !== undefined) store.lockWindowDays = changes.lock_window_days;
      if (changes.leave_escalation_threshold_days !== undefined) {
        store.escalationThresholdDays = changes.leave_escalation_threshold_days;
      }
      return ok(settings(), { meta: { message: "Attendance settings updated." } });
    });
  };
}
