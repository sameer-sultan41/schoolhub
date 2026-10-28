import type { ApiSchemas } from "@schoolhub/api-client";

/** The generated wire shapes (ADR-0017). */
export type LeaveRequestRecord = ApiSchemas["LeaveRequest"];
export type LeaveApprovalRecord = LeaveRequestRecord["approvals"][number];
export type LeaveTypeRecord = ApiSchemas["LeaveType"];

export type LeaveStatus = LeaveRequestRecord["status"];
export type LeaveApprovalDecision = LeaveApprovalRecord["decision"];
export type LeaveDayPart = NonNullable<LeaveRequestRecord["day_part"]>;

/** The two decisions, each its own route (`:approve`, `:reject`). */
export type LeaveAction = "approve" | "reject";

/**
 * One cursor page of the leave list. `dateFrom` keeps requests that start on or after it and
 * `dateTo` those that end on or before it (`date__gte` is `start_date`, `date__lte` is
 * `end_date`), so a range holds the requests that fall wholly inside it.
 */
export interface LeavePageQuery {
  cursor?: string;
  pageSize?: number;
  ordering?: string;
  status?: LeaveStatus;
  leaveTypeId?: string;
  dateFrom?: string;
  dateTo?: string;
}

/** A leave type as the filter lists it. */
export interface LeaveTypeOption {
  id: string;
  name: string;
}

/** A decided request, and how many attendance days an approval marked `on_leave`. */
export interface LeaveDecisionResult {
  request: LeaveRequestRecord;
  /** `meta.auto_marked_days`; `null` when the server sent none. */
  autoMarkedDays: number | null;
}
