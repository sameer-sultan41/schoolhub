import type { Page } from "@schoolhub/types";

import type { LeaveApprovalRecord, LeaveRequestRecord, LeaveTypeRecord } from "@/services";
import { STUDENT_ID } from "@/services/modules/student-attendance/__tests__/student-attendance-fixtures";

// UUID-shaped, like every id the server sends.
export const LEAVE_ID = "88888888-aaaa-4bbb-8ccc-000000000001";
export const OTHER_LEAVE_ID = "88888888-aaaa-4bbb-8ccc-000000000002";
export const THIRD_LEAVE_ID = "88888888-aaaa-4bbb-8ccc-000000000003";
export const FOURTH_LEAVE_ID = "88888888-aaaa-4bbb-8ccc-000000000004";
export const FIFTH_LEAVE_ID = "88888888-aaaa-4bbb-8ccc-000000000005";
export const SICK_TYPE_ID = "66666666-aaaa-4bbb-8ccc-000000000001";
export const CASUAL_TYPE_ID = "66666666-aaaa-4bbb-8ccc-000000000002";
export const STAFF_TYPE_ID = "66666666-aaaa-4bbb-8ccc-000000000003";
export const GUARDIAN_USER_ID = "55555555-aaaa-4bbb-8ccc-000000000001";
export const OTHER_APPROVER_ID = "55555555-aaaa-4bbb-8ccc-000000000002";
export const ATTACHMENT_FILE_ID = "44444444-aaaa-4bbb-8ccc-000000000001";

/** The key every step of the chain names (`STUDENT_LEAVE_APPROVE`): both levels take it. */
export const APPROVE_KEY = "attendance.leave-request.approve";

/** The sentences `services.decide_leave_step` raises, as the envelope carries them. */
export const ALREADY_APPROVED = "This request was already approved.";
export const OWN_REQUEST = "An approver cannot decide a request they submitted (§11).";
export const DECIDED_EARLIER =
  "You have already decided a step of this request; an escalation needs a second person.";
export const NEEDS_WIDER_SCOPE =
  "This request escalated past the threshold and needs an approver with campus-wide or school-wide scope.";

/** One step of the chain, still waiting. */
export function approvalStep(overrides: Partial<LeaveApprovalRecord> = {}): LeaveApprovalRecord {
  return {
    id: "77777777-aaaa-4bbb-8ccc-000000000001",
    level: 1,
    required_permission: APPROVE_KEY,
    approver_id: null,
    approver_name: null,
    decision: "pending",
    decided_at: null,
    note: null,
    ...overrides,
  };
}

/** A step an approver decided, with the note they left. */
export function decidedStep(
  overrides: Partial<LeaveApprovalRecord> & Pick<LeaveApprovalRecord, "approver_id">,
): LeaveApprovalRecord {
  return approvalStep({
    approver_name: "Zainab Qureshi",
    decision: "approved",
    decided_at: "2026-10-23T09:30:00Z",
    note: "Seen the medical note",
    ...overrides,
  });
}

/** A pending three-day request from a guardian: a one-step chain, waiting at level 1. */
export function leaveRecord(overrides: Partial<LeaveRequestRecord> = {}): LeaveRequestRecord {
  return {
    id: LEAVE_ID,
    requester_type: "student",
    student_id: STUDENT_ID,
    student_name: "Amna Raza",
    admission_number: "ADM-1042",
    section_name: "Grade 5 A",
    submitted_by: GUARDIAN_USER_ID,
    submitted_by_name: "Usman Raza",
    leave_type_id: SICK_TYPE_ID,
    leave_type_name: "Sick leave",
    start_date: "2026-10-26",
    end_date: "2026-10-28",
    day_part: "full",
    days_count: "3.0",
    reason: "Fever, and a visit to the doctor",
    attachment_file_id: null,
    status: "pending",
    current_approval_level: 1,
    decided_at: null,
    approvals: [approvalStep()],
    created_at: "2026-10-22T08:00:00Z",
    updated_at: "2026-10-22T08:00:00Z",
    ...overrides,
  };
}

/** A request long enough to escalate: two steps, level 1 decided by `approverId`, now at 2. */
export function escalatedRecord(
  approverId: string,
  overrides: Partial<LeaveRequestRecord> = {},
): LeaveRequestRecord {
  return leaveRecord({
    start_date: "2026-11-02",
    end_date: "2026-11-13",
    days_count: "12.0",
    current_approval_level: 2,
    approvals: [
      decidedStep({ id: "77777777-aaaa-4bbb-8ccc-000000000011", approver_id: approverId }),
      approvalStep({ id: "77777777-aaaa-4bbb-8ccc-000000000012", level: 2 }),
    ],
    ...overrides,
  });
}

/** A twelve-day request rejected at level 1: level 2 stays `pending`, as the server leaves it
 * (a rejection decides only its own step). */
export function rejectedEscalatedRecord(
  overrides: Partial<LeaveRequestRecord> = {},
): LeaveRequestRecord {
  return escalatedRecord(OTHER_APPROVER_ID, {
    status: "rejected",
    current_approval_level: 1,
    decided_at: "2026-10-23T09:30:00Z",
    approvals: [
      decidedStep({
        id: "77777777-aaaa-4bbb-8ccc-000000000011",
        approver_id: OTHER_APPROVER_ID,
        decision: "rejected",
        note: "Not covered by this leave type",
      }),
      approvalStep({ id: "77777777-aaaa-4bbb-8ccc-000000000012", level: 2 }),
    ],
    ...overrides,
  });
}

/** A twelve-day request cancelled before anyone decided: cancel touches no step, so both stay
 * `pending`. */
export function cancelledEscalatedRecord(
  overrides: Partial<LeaveRequestRecord> = {},
): LeaveRequestRecord {
  return escalatedRecord(OTHER_APPROVER_ID, {
    status: "cancelled",
    current_approval_level: 1,
    approvals: [
      approvalStep({ id: "77777777-aaaa-4bbb-8ccc-000000000011" }),
      approvalStep({ id: "77777777-aaaa-4bbb-8ccc-000000000012", level: 2 }),
    ],
    ...overrides,
  });
}

/** A leave type, by name; `applies_to` decides whether a student request can use it. */
export function leaveType(overrides: Partial<LeaveTypeRecord> = {}): LeaveTypeRecord {
  return {
    id: SICK_TYPE_ID,
    name: "Sick leave",
    code: "SICK",
    applies_to: "both",
    is_paid: true,
    requires_attachment: false,
    max_consecutive_days: null,
    is_active: true,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

/** One cursor page of leave requests, as `fetchLeavePage` returns it. */
export function leavePage(
  items: LeaveRequestRecord[],
  cursors: { next?: string | null; previous?: string | null } = {},
): Page<LeaveRequestRecord> {
  return {
    items,
    pagination: {
      next_cursor: cursors.next ?? null,
      previous_cursor: cursors.previous ?? null,
      page_size: 25,
    },
  };
}
