import type { ApiSchemas } from "@schoolhub/api-client";
import type { AuthenticatedUser, PermissionKey } from "@schoolhub/types";
import { uuid } from "@/data/factories";
import type { CorrectionRecord } from "./attendance-approvals-store";
import { hasWideScope } from "./attendance-mock-utils";
import {
  type AttendanceMode,
  type AttendanceRegisterStore,
  DEFAULT_DAY_END,
  DEFAULT_DAY_START,
  DEFAULT_GRACE_MINUTES,
  E2E_WORKING_DAYS,
  lateAfter,
  minutesBetween,
  shiftIsoDate,
  type StaffAttendanceStatus,
  todayUtc,
} from "./attendance-register-store";
import type { FileDownloadStub, JobsOptions, JobStub } from "./jobs";

/**
 * The server's state behind `attendanceStaffReportsModule` (`./attendance-staff-reports`): the
 * staff and their attendance rows, the report rows each kind answers with, and the jobs and
 * files an export or an import leaves for `jobsModule` to serve. Rows are seeded as the caller's
 * record scope would return them; only `own` (a staff member's own rows) is re-derived here.
 */

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

/** The generated `StaffAttendance`, writable here because this stub plays the server. */
export type StaffAttendanceRecord = Mutable<ApiSchemas["StaffAttendance"]>;
export type ReportKind = ApiSchemas["AttendanceReportQueryKindEnum"];
export type ReportFormat = ApiSchemas["FormatEnum"];
export type ReportRowOf<K extends ReportKind> = Extract<
  ApiSchemas["AttendanceReportRow"],
  { kind: K }
>;
/** A report row as the store holds it: no `kind` (the stub adds the one asked for), and the
 * section its student sits in, which `section_id` narrows on. */
export type ReportSeed<K extends ReportKind> = Omit<Mutable<ReportRowOf<K>>, "kind"> & {
  section_id?: string | null;
};
/** `defaulters` has no seeds of its own: the server filters the student summary's rows. */
export type ReportSeeds = { [K in Exclude<ReportKind, "defaulters">]?: ReportSeed<K>[] };

/** The sentences `services.py` and the staff serializers send, copied verbatim (L5). */
export const STAFF_ATTENDANCE_MESSAGES = {
  locked: "This record is locked and must be changed through a correction request.",
  checkOutLocked: "This record is locked and must be changed through a correction.",
  noCheckIn: "This record has no check-in to check out from.",
  checkOutNotAfter: "Check-out must be later than check-in (§11).",
  /** The serializer's own wording, which runs before the service's. */
  checkOutNotAfterBody: "Check-out must be later than check-in.",
  systemOnly: "'on_leave' is written by an approved leave request, not marked.",
  checkedOut: "Check-out recorded.",
} as const;

/** `AttendanceReportView`'s and `AttendanceImportViewSet`'s sentences (L5). */
export const REPORT_MESSAGES = {
  rangeBackwards: "The range ends before it starts.",
  queuedInline: "Report queued: too many rows to return inline.",
  queuedExport: "Report queued: export requested.",
  importQueued: "Historical import queued.",
} as const;

/** `services.STAFF_TIMED_STATUSES`: the days a person worked, the only ones with minutes. */
const STAFF_TIMED_STATUSES: readonly StaffAttendanceStatus[] = ["present", "late", "half_day"];

/** `services.SYNCHRONOUS_REPORT_ROW_LIMIT`: more rows than this come back as a job. */
export const SYNCHRONOUS_REPORT_ROW_LIMIT = 1000;
/** `reports.DEFAULT_DEFAULTER_THRESHOLD`. */
export const DEFAULT_DEFAULTER_THRESHOLD = 75;

/** A staff member as the register and the rows name them. */
export interface StaffMember {
  id: string;
  firstName: string;
  lastName: string;
  employeeNumber: string;
  department: { id: string; name: string } | null;
  /** The login linked to the row: a staff member reading under `own` scope sees only these. */
  userId: string | null;
  /** `joining_date`: the register lists only staff who had joined by its date. */
  joiningDate: string;
  /** `employment_status = active`; anyone else is off the register. */
  active: boolean;
}

/** `Staff.full_name`. */
export function staffName(member: StaffMember): string {
  return `${member.firstName} ${member.lastName}`;
}

/** What an export was asked for, kept for a spec to assert. */
export interface ExportRequest {
  jobId: string;
  query: Record<string, string | null>;
  format: ReportFormat;
  rows: number;
}

export interface AttendanceStaffReportsOptions {
  /** The signed-in caller: their permission keys and role scopes decide what the server allows. */
  user: AuthenticatedUser;
  staff?: StaffMember[];
  records?: StaffAttendanceRecord[];
  /** The student side, for a correction on a student row and for the historical import. */
  register?: AttendanceRegisterStore;
  /** `staffId:date` pairs that approved staff leave covers. */
  leave?: string[];
  reportRows?: ReportSeeds;
  attendanceMode?: AttendanceMode;
  /** `attendance_lock_window_days`; §19's default is 0. */
  lockWindowDays?: number;
  holidays?: Record<string, string>;
  workingDays?: readonly number[];
  /** An import file's text by its name: browser interception does not carry a file's bytes. */
  importFiles?: Record<string, string>;
}

export class AttendanceStaffReportsStore {
  readonly user: AuthenticatedUser;
  readonly staff: StaffMember[];
  readonly records: StaffAttendanceRecord[];
  readonly register: AttendanceRegisterStore | undefined;
  readonly leave: Set<string>;
  readonly reportRows: ReportSeeds;
  attendanceMode: AttendanceMode;
  lockWindowDays: number;
  readonly holidays: Record<string, string>;
  readonly workingDays: readonly number[];
  readonly importFiles: Record<string, string>;
  readonly dayStart = DEFAULT_DAY_START;
  readonly dayEnd = DEFAULT_DAY_END;
  readonly graceMinutes = DEFAULT_GRACE_MINUTES;
  /** `jobsModule`'s poll sequences and files, shared by reference: a job queued here is served
   * there. Pass `jobsOptions()` to `jobsModule`. */
  readonly jobs: Record<string, JobStub[]> = {};
  readonly files: FileDownloadStub[] = [];
  readonly exports: ExportRequest[] = [];
  readonly corrections: CorrectionRecord[] = [];

  constructor(options: AttendanceStaffReportsOptions) {
    this.user = options.user;
    this.staff = options.staff ?? [];
    this.records = [...(options.records ?? [])];
    this.register = options.register;
    this.leave = new Set(options.leave ?? []);
    this.reportRows = options.reportRows ?? {};
    this.attendanceMode = options.attendanceMode ?? "daily";
    this.lockWindowDays = options.lockWindowDays ?? options.register?.lockWindowDays ?? 0;
    this.holidays = options.holidays ?? {};
    this.workingDays = options.workingDays ?? E2E_WORKING_DAYS;
    this.importFiles = options.importFiles ?? {};
  }

  jobsOptions(): JobsOptions {
    return { jobs: this.jobs, files: this.files };
  }

  holds(...keys: PermissionKey[]): boolean {
    return keys.some((key) => this.user.permissions.includes(key));
  }

  /** The staff the caller's record scope reaches: everyone under a wide scope
   * (`hasWideScope`), else their own (`Staff.user_id`, under `own`). */
  visibleStaff(): StaffMember[] {
    return hasWideScope(this.user)
      ? this.staff
      : this.staff.filter((member) => member.userId === this.user.id);
  }

  member(staffId: string): StaffMember | undefined {
    return this.staff.find((member) => member.id === staffId);
  }

  lockCutoff(): string {
    return shiftIsoDate(todayUtc(), -this.lockWindowDays);
  }

  isLocked(record: StaffAttendanceRecord): boolean {
    return record.is_locked || record.attendance_date < this.lockCutoff();
  }

  serialize(record: StaffAttendanceRecord): StaffAttendanceRecord {
    return { ...record, is_locked: this.isLocked(record) };
  }

  find(staffId: string, date: string): StaffAttendanceRecord | undefined {
    return this.records.find((row) => row.staff_id === staffId && row.attendance_date === date);
  }

  /** `services.staff_minutes`: none unless the day was worked (present, late or half day); then
   * late only on a late day with a check-in, and early whenever out. */
  minutes(
    status: StaffAttendanceStatus,
    checkIn: string | null,
    checkOut: string | null,
  ): Pick<StaffAttendanceRecord, "late_minutes" | "early_departure_minutes"> {
    if (!STAFF_TIMED_STATUSES.includes(status)) {
      return { late_minutes: null, early_departure_minutes: null };
    }
    return {
      late_minutes:
        status === "late" && checkIn ? lateAfter(this.dayStart, checkIn, this.graceMinutes) : null,
      early_departure_minutes: checkOut ? Math.max(minutesBetween(checkOut, this.dayEnd), 0) : null,
    };
  }

  /** A row for `member` on `date`, as the server would have written it. */
  recordFor(
    member: StaffMember,
    date: string,
    overrides: Partial<StaffAttendanceRecord> = {},
  ): StaffAttendanceRecord {
    const status = overrides.status ?? "present";
    const checkIn = overrides.check_in_time ?? null;
    const checkOut = overrides.check_out_time ?? null;
    return {
      id: uuid(),
      staff_id: member.id,
      staff_name: staffName(member),
      employee_number: member.employeeNumber,
      attendance_date: date,
      status,
      check_in_time: checkIn,
      check_out_time: checkOut,
      ...this.minutes(status, checkIn, checkOut),
      leave_request_id: null,
      source: "manual",
      marked_by: this.user.id,
      is_locked: false,
      remarks: null,
      created_at: "2026-10-01T08:00:00Z",
      updated_at: "2026-10-01T08:00:00Z",
      ...overrides,
    };
  }
}

/** A staff member, defaults filled in. */
export function buildStaffMember(overrides: Partial<StaffMember> = {}): StaffMember {
  return {
    id: uuid(),
    firstName: "Imran",
    lastName: "Siddiqui",
    employeeNumber: "EMP-001",
    department: null,
    userId: null,
    joiningDate: "2024-08-01",
    active: true,
    ...overrides,
  };
}
