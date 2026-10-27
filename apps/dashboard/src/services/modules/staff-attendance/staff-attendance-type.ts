import type { ApiSchemas } from "@schoolhub/api-client";

/** The generated wire shapes (ADR-0017). */
export type StaffAttendanceRecord = ApiSchemas["StaffAttendance"];
export type StaffRegisterEntry = ApiSchemas["StaffRegisterEntry"];
export type StaffAttendanceStatus = ApiSchemas["StaffAttendanceStatusEnum"];

/** A status the staff register may set: `on_leave` is written by an approved leave request and
 * `holiday` is the school being shut, neither a mark. */
export type MarkableStaffStatus = Exclude<StaffAttendanceStatus, "on_leave" | "holiday">;

/** One register row's unsaved choices: times as `HH:MM`, blanks as `""`, and `status` `""` until
 * one is picked (or while the saved status is not one the register may set). */
export interface StaffRowDraft {
  status: MarkableStaffStatus | "";
  checkInTime: string;
  remarks: string;
}

export interface StaffRegisterQuery {
  /** `YYYY-MM-DD`. */
  date: string;
  departmentId?: string;
}

/** One staff member's day, as `POST /staff-attendance` takes it: an upsert, so every time and
 * the remarks are sent as they should end up (a key left out is cleared by the server). */
export interface MarkStaffAttendanceInput {
  staffId: string;
  /** `YYYY-MM-DD`. */
  attendanceDate: string;
  status: MarkableStaffStatus;
  checkInTime: string | null;
  checkOutTime: string | null;
  remarks: string | null;
}

/** The history list's filters; `cursor` pages, `dateFrom`/`dateTo` bound `attendance_date`. */
export interface StaffAttendancePageQuery {
  cursor?: string;
  pageSize?: number;
  ordering?: string;
  status?: StaffAttendanceStatus;
  dateFrom?: string;
  dateTo?: string;
  staffId?: string;
}
