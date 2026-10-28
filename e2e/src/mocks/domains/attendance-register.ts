import { uuid } from "@/data/factories";
import { fail, ok, paginated, type MockResponse } from "../envelope";
import { invalidCursorResponse, lockedSessionResponse } from "../list";
import type { MockModule } from "../router";
import {
  ATTENDANCE_MESSAGES,
  type AttendanceRecord,
  type AttendanceRegisterStore,
  type AttendanceStatus,
  todayUtc,
} from "./attendance-register-store";

/** `services.ALERT_STATUSES`: a row that becomes one of these queues a guardian alert. */
const ALERT_STATUSES: readonly AttendanceStatus[] = ["absent", "late"];
/** `services.CORRECTABLE_FIELDS`. */
const CORRECTABLE_FIELDS = ["status", "check_in_time", "check_out_time", "remarks"] as const;

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

interface DateIssue {
  reason: "future" | "holiday" | "non_working_day";
  holidayName: string | null;
}

/** Python's `date.weekday()`: Monday = 0, where JavaScript's `getUTCDay()` has Sunday = 0. */
function pythonWeekday(isoDate: string): number {
  return (new Date(`${isoDate}T00:00:00Z`).getUTCDay() + 6) % 7;
}

/** `unmarkable_date_issue`, in the server's order: future, holiday, then a non-working day. */
function dateIssue(store: AttendanceRegisterStore, date: string): DateIssue | null {
  if (date > todayUtc()) return { reason: "future", holidayName: null };
  const holidayName = store.holidays[date];
  if (holidayName) return { reason: "holiday", holidayName };
  if (!store.workingDays.includes(pythonWeekday(date))) {
    return { reason: "non_working_day", holidayName: null };
  }
  return null;
}

/** `assert_markable_date`'s sentence for each reason. */
function dateRefusal(date: string, issue: DateIssue): MockResponse {
  const messages: Record<DateIssue["reason"], string> = {
    future: ATTENDANCE_MESSAGES.future,
    holiday: `${date} is ${issue.holidayName}; the school is closed.`,
    non_working_day: `${date} is not a working day for this school.`,
  };
  return refusal("attendance_date", messages[issue.reason]);
}

/**
 * `calendar.late_minutes`: minutes after the day's start, never client-supplied. Measured from
 * the start, not from the end of the grace window; within the grace it is 0 (`_late_after`).
 */
function lateMinutes(store: AttendanceRegisterStore, checkIn: string): number {
  const minutes = (time: string) => {
    const [hours = 0, mins = 0] = time.split(":").map(Number);
    return hours * 60 + mins;
  };
  const late = minutes(checkIn) - minutes(store.dayStart);
  return late <= store.graceMinutes ? 0 : late;
}

/** `HH:MM`, what a `<input type="time">` sends. */
const SHORT_TIME_LENGTH = 5;

/** DRF's `TimeField` answers `HH:MM:SS`. */
function asTime(value: unknown): string | null {
  if (typeof value !== "string" || value === "") return null;
  return value.length === SHORT_TIME_LENGTH ? `${value}:00` : value;
}

interface BulkMarkEntry {
  student_id: string;
  status: AttendanceStatus;
  check_in_time?: string;
  check_out_time?: string;
  remarks?: string;
}

interface CorrectionBody {
  student_attendance_id?: string;
  new_values?: Record<string, unknown>;
  reason?: string;
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

    api.post("/attendance-corrections", (request) => {
      const body = (request.json() as CorrectionBody | null) ?? {};
      const target = store.records.find((row) => row.id === body.student_attendance_id);
      if (!target) return fail(404, "Not found.");
      if (!store.isLocked(target)) {
        return refusal("student_attendance_id", ATTENDANCE_MESSAGES.correctionNotLocked);
      }
      const proposed = Object.fromEntries(
        CORRECTABLE_FIELDS.filter((field) => field in (body.new_values ?? {})).map((field) => [
          field,
          body.new_values?.[field],
        ]),
      );
      if (Object.keys(proposed).length === 0) {
        return refusal("new_values", `Name at least one of: ${CORRECTABLE_FIELDS.join(", ")}.`);
      }
      const old = Object.fromEntries(
        Object.keys(proposed).map((field) => [field, target[field as keyof AttendanceRecord]]),
      );
      if (JSON.stringify(old) === JSON.stringify(proposed)) {
        return refusal("new_values", ATTENDANCE_MESSAGES.correctionUnchanged);
      }
      const now = new Date().toISOString();
      return ok(
        {
          id: uuid(),
          subject_type: "student",
          student_attendance_id: target.id,
          student_id: target.student_id,
          student_name: target.student_name,
          attendance_date: target.attendance_date,
          period_name: target.period_name,
          requested_by: store.userId,
          // The mock's signed-in user has no name; the server's is nullable.
          requested_by_name: null,
          old_values: old,
          new_values: proposed,
          reason: body.reason ?? "",
          status: "pending",
          reviewed_by: null,
          reviewed_by_name: null,
          reviewed_at: null,
          review_note: null,
          created_at: now,
          updated_at: now,
        },
        { status: 201 },
      );
    });

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
