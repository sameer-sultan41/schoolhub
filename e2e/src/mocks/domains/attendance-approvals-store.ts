import type { ApiSchemas } from "@schoolhub/api-client";
import type { AuthenticatedUser } from "@schoolhub/types";
import { uuid } from "@/data/factories";
import { shiftIsoDate, todayUtc } from "./attendance-register-store";

/**
 * The approvals server's state behind `attendanceApprovalsModule` (`./attendance-approvals`):
 * correction requests, student leave requests with their chains, the leave-type catalogue, and
 * who is asking. Rows are seeded as the caller's record scope would return them; the stub does
 * not re-derive campus or section reach, only the rules `services.py` itself applies.
 */

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

/** The generated shapes, writable here because this stub plays the server. */
export type CorrectionRecord = Mutable<ApiSchemas["AttendanceCorrection"]>;
export type LeaveApprovalRecord = Mutable<ApiSchemas["LeaveApproval"]>;
export type LeaveRequestRecord = Omit<Mutable<ApiSchemas["LeaveRequest"]>, "approvals"> & {
  approvals: LeaveApprovalRecord[];
};
export type LeaveTypeRecord = Mutable<ApiSchemas["LeaveType"]>;

/** The sentences `decide_correction` and `decide_leave_step` send, copied verbatim (L5). */
export const APPROVAL_MESSAGES = {
  correctionDecided: (status: string) => `This correction was already ${status}.`,
  ownCorrection: "An approver cannot decide their own correction request (§11).",
  leaveDecided: (status: string) => `This request was already ${status}.`,
  noPendingStep: "This request has no pending approval step.",
  ownLeave: "An approver cannot decide a request they submitted (§11).",
  secondLevel:
    "You have already decided a step of this request; an escalation needs a second person.",
  escalationScope:
    "This request escalated past the threshold and needs an approver with campus-wide or " +
    "school-wide scope.",
} as const;

/** `services.STUDENT_LEAVE_APPROVE`: both levels of the chain take the same key. */
export const STUDENT_LEAVE_APPROVE = "attendance.leave-request.approve";

const CREATED_AT = "2026-10-20T08:00:00Z";

export function buildCorrection(overrides: Partial<CorrectionRecord> = {}): CorrectionRecord {
  return {
    id: uuid(),
    subject_type: "student",
    student_attendance_id: uuid(),
    student_id: uuid(),
    student_name: "Amna Raza",
    attendance_date: shiftIsoDate(todayUtc(), -3),
    period_name: null,
    requested_by: uuid(),
    requested_by_name: "Imran Siddiqui",
    old_values: { status: "present" },
    new_values: { status: "absent" },
    reason: "Marked present by mistake.",
    status: "pending",
    reviewed_by: null,
    reviewed_by_name: null,
    reviewed_at: null,
    review_note: null,
    created_at: CREATED_AT,
    updated_at: CREATED_AT,
    ...overrides,
  };
}

export function buildLeaveType(overrides: Partial<LeaveTypeRecord> = {}): LeaveTypeRecord {
  return {
    id: uuid(),
    name: "Sick leave",
    code: "SICK",
    applies_to: "both",
    is_paid: false,
    requires_attachment: false,
    max_consecutive_days: null,
    is_active: true,
    created_at: CREATED_AT,
    updated_at: CREATED_AT,
    ...overrides,
  };
}

/** A pending step, as `submit_leave_request` writes each level of the chain. */
export function pendingStep(level: number): LeaveApprovalRecord {
  return {
    id: uuid(),
    level,
    required_permission: STUDENT_LEAVE_APPROVE,
    approver_id: null,
    approver_name: null,
    decision: "pending",
    decided_at: null,
    note: null,
  };
}

/** Calendar days from `start` to `end`, inclusive: the e2e week has seven working days and no
 * holidays, so this is `leave_days_between` for a full-day request. */
export function calendarDays(start: string, end: string): number {
  return Math.round((Date.parse(end) - Date.parse(start)) / 86_400_000) + 1;
}

/**
 * A pending request for `days` full days from tomorrow, with the chain `student_leave_chain`
 * builds for that length: a second level when `days` exceeds `escalationThresholdDays`.
 */
export function buildLeaveRequest(
  options: { days: number; escalationThresholdDays?: number; leaveType: LeaveTypeRecord },
  overrides: Partial<LeaveRequestRecord> = {},
): LeaveRequestRecord {
  const start = shiftIsoDate(todayUtc(), 1);
  const levels = options.days > (options.escalationThresholdDays ?? 10) ? 2 : 1;
  return {
    id: uuid(),
    requester_type: "student",
    student_id: uuid(),
    student_name: "Amna Raza",
    admission_number: "ADM-001",
    section_name: "A",
    submitted_by: uuid(),
    submitted_by_name: "Usman Raza",
    leave_type_id: options.leaveType.id,
    leave_type_name: options.leaveType.name,
    start_date: start,
    end_date: shiftIsoDate(start, options.days - 1),
    day_part: "full",
    days_count: `${options.days}.0`,
    reason: "Fever; the doctor advised rest.",
    attachment_file_id: null,
    status: "pending",
    current_approval_level: 1,
    decided_at: null,
    approvals: Array.from({ length: levels }, (_, index) => pendingStep(index + 1)),
    created_at: CREATED_AT,
    updated_at: CREATED_AT,
    ...overrides,
  };
}

export interface AttendanceApprovalsOptions {
  /** The signed-in caller: their id, name and role scopes decide what the server allows. */
  user: AuthenticatedUser;
  corrections?: CorrectionRecord[];
  leaveRequests?: LeaveRequestRecord[];
  leaveTypes?: LeaveTypeRecord[];
}

/**
 * The approvals server's state for one spec. Its rows are the spec's to change between steps
 * (another approver decides a request while a dialog is open), which is how a 409 is staged.
 */
export class AttendanceApprovalsStore {
  readonly user: AuthenticatedUser;
  readonly corrections: CorrectionRecord[];
  readonly leaveRequests: LeaveRequestRecord[];
  readonly leaveTypes: LeaveTypeRecord[];

  constructor(options: AttendanceApprovalsOptions) {
    this.user = options.user;
    this.corrections = [...(options.corrections ?? [])];
    this.leaveRequests = [...(options.leaveRequests ?? [])];
    this.leaveTypes = [...(options.leaveTypes ?? [])];
  }

  /**
   * Any role holds `all` or `campus` scope. Record reads take the broadest scope
   * (`scope_queryset`: all > campus > own > assigned), not a union; only the level-2
   * escalation check reads every role like a union.
   */
  hasWideScope(): boolean {
    return this.user.roles.some(
      (role) => role.scope === "all" || (role.scope?.startsWith("campus:") ?? false),
    );
  }

  /**
   * The corrections the caller's record scope returns: a wide scope reads the queue, while an
   * `assigned` (or `own`) caller reads only their own requests
   * (`AttendanceCorrection.filter_assigned_to_user`), whichever key let them in.
   */
  visibleCorrections(): CorrectionRecord[] {
    return this.hasWideScope()
      ? this.corrections
      : this.corrections.filter((row) => row.requested_by === this.user.id);
  }

  correction(id: string): CorrectionRecord | undefined {
    return this.corrections.find((row) => row.id === id);
  }

  leaveRequest(id: string): LeaveRequestRecord | undefined {
    return this.leaveRequests.find((row) => row.id === id);
  }
}
