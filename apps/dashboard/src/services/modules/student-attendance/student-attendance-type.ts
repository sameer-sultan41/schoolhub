import type { ApiSchemas } from "@schoolhub/api-client";

import type { AttendanceMode } from "@/services/modules/attendance-settings/attendance-settings-type";

/** The generated wire shapes (ADR-0017). */
export type StudentAttendanceRecord = ApiSchemas["StudentAttendance"];
export type RegisterEntry = ApiSchemas["RegisterEntry"];
export type MyRegister = ApiSchemas["MyRegister"];
export type AttendanceStatus = ApiSchemas["AttendanceStatusEnum"];

/** A status a register may submit: `on_leave` is written by an approved leave request only. */
export type MarkableStatus = Exclude<AttendanceStatus, "on_leave">;

/** Why a register is read-only (`meta.unmarkable_reason`). The lock is per row, not here. */
export type UnmarkableReason = "future" | "holiday" | "non_working_day" | "session_closed";

/** The register's `meta`. The API leaves it untyped, so this follows `register_meta`. */
export interface RegisterMeta {
  attendanceMode: AttendanceMode;
  isLocked: boolean;
  markable: boolean;
  unmarkableReason: UnmarkableReason | null;
  holidayName: string | null;
  academicSessionId: string | null;
}

export interface RegisterQuery {
  sectionId: string;
  /** `YYYY-MM-DD`. */
  date: string;
  /** Required by the server in period mode, refused in daily mode. */
  periodId?: string;
}

export interface MyRegistersResult {
  registers: MyRegister[];
  attendanceMode: AttendanceMode;
}

export interface RegisterResult {
  entries: RegisterEntry[];
  meta: RegisterMeta;
}

export interface BulkMarkEntryInput {
  studentId: string;
  status: MarkableStatus;
  checkInTime?: string | null;
  checkOutTime?: string | null;
  remarks?: string | null;
}

export interface BulkMarkInput {
  sectionId: string;
  /** `YYYY-MM-DD`. */
  attendanceDate: string;
  periodId?: string | null;
  /** Left out, the server picks the session containing the date. */
  academicSessionId?: string;
  entries: BulkMarkEntryInput[];
}

/** The records list's filters; `cursor` pages, `dateFrom`/`dateTo` bound `attendance_date`. */
export interface AttendancePageQuery {
  cursor?: string;
  pageSize?: number;
  search?: string;
  ordering?: string;
  status?: AttendanceStatus;
  date?: string;
  dateFrom?: string;
  dateTo?: string;
  /** A section's class: the rows of every section of it. */
  classId?: string;
  sectionId?: string;
  studentId?: string;
  periodId?: string;
  academicSessionId?: string;
  isLocked?: boolean;
}

/** The `:bulk-mark` answer: the rows as written, and what the submission did. */
export interface BulkMarkResult {
  records: StudentAttendanceRecord[];
  meta: BulkMarkMeta;
}

export interface BulkMarkMeta {
  /** Rows created. */
  marked: number;
  /** Existing rows changed. */
  updated: number;
  /** Guardian alerts queued. */
  alertsQueued: number;
}

/** One refused register row (`error.meta.rows[]`): the server's own sentence. */
export interface RowIssue {
  student_id: string;
  issue: string;
}
