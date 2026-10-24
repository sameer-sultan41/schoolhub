import type { ApiSchemas } from "@schoolhub/api-client";
import { uuid } from "@/data/factories";
import type { AcademicSession } from "./school-organization";

/**
 * The attendance server's state behind `attendanceRegisterModule` (`./attendance-register`):
 * the roster, the stored rows and the settings, plus the server's sentences and its lock rule.
 */

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

export type AttendanceStatus = ApiSchemas["AttendanceStatusEnum"];
export type AttendanceMode = ApiSchemas["AttendanceModeEnum"];
/** The generated `StudentAttendance`, writable here because this stub plays the server. */
export type AttendanceRecord = Mutable<ApiSchemas["StudentAttendance"]>;

/** The sentences `apps/api/apps/attendance/services.py` sends, copied verbatim (L5). */
export const ATTENDANCE_MESSAGES = {
  rowsRefused: "Some rows could not be marked; the register was not saved.",
  onLeaveRefused: "Some students are on approved leave; the register was not saved.",
  notEnrolled: "Not actively enrolled in this section for this session.",
  duplicate: "Listed more than once in this register.",
  systemOnly: "'on_leave' is written by an approved leave request, not marked at the register.",
  onApprovedLeave:
    "This student has approved leave on this date; cancel the leave request before marking them.",
  locked: "Some of these records are locked and must be changed through a correction request.",
  emptyRegister: "A register with no rows marks nothing.",
  dailyWithPeriod: "This school takes attendance once a day; leave the period out.",
  periodWithout: "This school takes attendance per period; name the period.",
  future: "Attendance records what happened; it cannot be marked ahead.",
  timetableRequired: "Period attendance needs the timetable module; turn it on first.",
  correctionNotLocked: "This record is still within the marking window; edit the register instead.",
  correctionUnchanged: "The proposed values match the record (§11).",
} as const;

const DAY_MS = 86_400_000;
const ISO_DATE_LENGTH = 10;

/** The server's today: `timezone.localdate()` under `TIME_ZONE = "UTC"` (L20), which is also
 * what the dashboard's `todayIsoDate()` reads. */
export function todayUtc(): string {
  return new Date().toISOString().slice(0, ISO_DATE_LENGTH);
}

export function shiftIsoDate(isoDate: string, days: number): string {
  return new Date(Date.parse(`${isoDate}T00:00:00Z`) + days * DAY_MS)
    .toISOString()
    .slice(0, ISO_DATE_LENGTH);
}

/** A student on a section's roster, in roll order. */
export interface RosterStudent {
  id: string;
  name: string;
  admissionNumber: string;
  rollNumber: string | null;
}

export interface RegisterSection {
  id: string;
  name: string;
  classId: string;
  className: string;
  campusId: string;
  /** Actively enrolled this session: the register's roster and `:bulk-mark`'s enrolled set. */
  students: RosterStudent[];
  /** Whether the signed-in user class-teaches it, which is what lists it in `my-registers`. */
  classTeacher: boolean;
}

export function buildAttendanceRecord(overrides: Partial<AttendanceRecord> = {}): AttendanceRecord {
  return {
    id: uuid(),
    student_id: uuid(),
    student_name: "Amna Raza",
    admission_number: "ADM-001",
    section_id: uuid(),
    section_name: "A",
    academic_session_id: uuid(),
    period_id: null,
    period_name: null,
    attendance_date: todayUtc(),
    status: "present",
    check_in_time: null,
    check_out_time: null,
    late_minutes: null,
    leave_request_id: null,
    source: "manual",
    marked_by: uuid(),
    is_locked: false,
    remarks: null,
    created_at: "2026-10-01T08:00:00Z",
    updated_at: "2026-10-01T08:00:00Z",
    ...overrides,
  };
}

export interface AttendanceRegisterOptions {
  session: AcademicSession;
  sections: RegisterSection[];
  records?: AttendanceRecord[];
  mode?: AttendanceMode;
  /** `attendance_lock_window_days`; §19's default is 0 (`DEFAULT_LOCK_WINDOW_DAYS`). */
  lockWindowDays?: number;
  escalationThresholdDays?: number;
  /** `module.timetable`: period mode, and every period register, is refused while it is off. */
  timetableEnabled?: boolean;
  holidays?: Record<string, string>;
  /** `academic.working_days`, Monday = 0 as Python's `weekday()` numbers them. */
  workingDays?: readonly number[];
  userId?: string;
  /** Where lateness is measured from: the tenant day window's start. */
  dayStart?: string;
  /** Minutes after the start that still count as on time. */
  graceMinutes?: number;
}

/**
 * Every day of the week. The e2e seed configures a seven-day week (`seed_e2e_data.py`'s
 * `_ensure_seven_day_week`) because the lanes mark *today*, which is not always a weekday; the
 * server's own default is Monday to Friday (`calendar.DEFAULT_WORKING_DAYS`).
 */
export const E2E_WORKING_DAYS: readonly number[] = [0, 1, 2, 3, 4, 5, 6];

/** `calendar.DEFAULT_DAY_WINDOW`, which the e2e seed leaves unconfigured: the day starts at
 * 08:00, and a check-in up to 10 minutes after it is on time. */
export const DEFAULT_DAY_START = "08:00:00";
export const DEFAULT_GRACE_MINUTES = 10;

/**
 * The attendance server's state for one spec. Its fields are the spec's to change between
 * steps (a student withdrawn, leave approved after the register loaded), which is how a
 * refusal the user meets mid-flow is staged.
 */
export class AttendanceRegisterStore {
  readonly session: AcademicSession;
  readonly sections: RegisterSection[];
  readonly records: AttendanceRecord[];
  mode: AttendanceMode;
  lockWindowDays: number;
  escalationThresholdDays: number;
  timetableEnabled: boolean;
  readonly holidays: Record<string, string>;
  readonly workingDays: readonly number[];
  readonly userId: string;
  readonly dayStart: string;
  readonly graceMinutes: number;

  constructor(options: AttendanceRegisterOptions) {
    this.session = options.session;
    this.sections = options.sections;
    this.records = [...(options.records ?? [])];
    this.mode = options.mode ?? "daily";
    this.lockWindowDays = options.lockWindowDays ?? 0;
    this.escalationThresholdDays = options.escalationThresholdDays ?? 10;
    this.timetableEnabled = options.timetableEnabled ?? true;
    this.holidays = options.holidays ?? {};
    this.workingDays = options.workingDays ?? E2E_WORKING_DAYS;
    this.userId = options.userId ?? uuid();
    this.dayStart = options.dayStart ?? DEFAULT_DAY_START;
    this.graceMinutes = options.graceMinutes ?? DEFAULT_GRACE_MINUTES;
  }

  /** Approved leave writes a daily `on_leave` row (`apply_approved_leave`). */
  approveLeave(studentId: string, date: string): void {
    const section = this.sectionOf(studentId);
    const student = section?.students.find((candidate) => candidate.id === studentId);
    if (!section || !student) throw new Error(`no rostered student ${studentId}`);
    this.records.push(
      this.recordFor(section, student, date, {
        status: "on_leave",
        source: "system",
        leave_request_id: uuid(),
      }),
    );
  }

  /** The student leaves the section: off the roster, and no longer enrolled for `:bulk-mark`. */
  withdraw(studentId: string): void {
    const section = this.sectionOf(studentId);
    if (!section) throw new Error(`no rostered student ${studentId}`);
    section.students.splice(
      section.students.findIndex((s) => s.id === studentId),
      1,
    );
  }

  /** The first date still inside the lock window. */
  lockCutoff(): string {
    return shiftIsoDate(todayUtc(), -this.lockWindowDays);
  }

  /** `row.is_locked or is_locked(row.attendance_date)`, as the serializer reports it. */
  isLocked(record: AttendanceRecord): boolean {
    return record.is_locked || record.attendance_date < this.lockCutoff();
  }

  serialize(record: AttendanceRecord): AttendanceRecord {
    return { ...record, is_locked: this.isLocked(record) };
  }

  sectionOf(studentId: string): RegisterSection | undefined {
    return this.sections.find((section) => section.students.some((s) => s.id === studentId));
  }

  recordFor(
    section: RegisterSection,
    student: RosterStudent,
    date: string,
    overrides: Partial<AttendanceRecord> = {},
  ): AttendanceRecord {
    return buildAttendanceRecord({
      student_id: student.id,
      student_name: student.name,
      admission_number: student.admissionNumber,
      section_id: section.id,
      section_name: section.name,
      academic_session_id: this.session.id,
      attendance_date: date,
      marked_by: this.userId,
      ...overrides,
    });
  }

  /** The row for (student, date, period): what the unique indexes key on, not the section. */
  find(studentId: string, date: string, periodId: string | null): AttendanceRecord | undefined {
    return this.records.find(
      (row) =>
        row.student_id === studentId &&
        row.attendance_date === date &&
        (row.period_id ?? null) === periodId,
    );
  }
}
