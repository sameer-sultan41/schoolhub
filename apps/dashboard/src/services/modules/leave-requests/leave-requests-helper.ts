import type { AuthenticatedUser } from "@schoolhub/types";

import { FILTER_ALL } from "@/lib/constants";
import { copyMappedFields } from "@/lib/helpers";
import {
  AUTO_MARKED_DAYS_KEY,
  LEAVE_DAYS_FRACTION_DIGITS,
  LEAVE_QUERY_FIELDS,
  LEAVE_STATUS_PENDING,
  LEAVE_STEP_PERMISSION_LABELS,
  LEAVE_TYPE_STAFF_ONLY,
} from "./leave-requests-constant";
import type {
  LeaveApprovalRecord,
  LeaveAction,
  LeaveDecisionResult,
  LeavePageQuery,
  LeaveRequestRecord,
  LeaveStatus,
  LeaveTypeOption,
  LeaveTypeRecord,
} from "./leave-requests-type";

/** The leave-requests module's pure helpers. */

export function toLeaveQueryParams(
  query: LeavePageQuery,
): Record<string, string | number | undefined> {
  const params: Record<string, unknown> = { page_size: query.pageSize };
  copyMappedFields(
    query,
    LEAVE_QUERY_FIELDS,
    (value) => value !== undefined && value !== "",
    params,
  );
  return params as Record<string, string | number | undefined>;
}

/** The status filter -> `status`: `all` is no filter. */
export function statusFilterToStatus(value: string): LeaveStatus | undefined {
  return value === FILTER_ALL ? undefined : (value as LeaveStatus);
}

/** The `:approve` / `:reject` body: the note when there is one, an empty body otherwise. */
export function toDecisionBody(note?: string): Record<string, unknown> {
  const trimmed = note?.trim();
  return trimmed ? { note: trimmed } : {};
}

/** `meta.auto_marked_days` as a count, or `null` when the server sent none. */
export function toAutoMarkedDays(meta: Record<string, unknown> | undefined): number | null {
  const value = meta?.[AUTO_MARKED_DAYS_KEY];
  return typeof value === "number" ? value : null;
}

/** Whether `user` is the one who submitted the request: the server refuses them a decision. */
export function isOwnLeaveRequest(
  request: LeaveRequestRecord,
  user: AuthenticatedUser | undefined,
): boolean {
  return user !== undefined && request.submitted_by === user.id;
}

/** Whether `user` already decided a step of the chain: an escalation needs a second person. */
export function hasDecidedLeaveStep(
  request: LeaveRequestRecord,
  user: AuthenticatedUser | undefined,
): boolean {
  return user !== undefined && request.approvals.some((step) => step.approver_id === user.id);
}

/**
 * Whether Approve and Reject are offered: a pending request, not the viewer's own, that they
 * have decided no level of, to a holder of `attendance.leave-request.approve`. The server
 * enforces each of these itself, and adds one the browser cannot see: level 2 needs a campus or
 * school-wide scope.
 */
export function canDecideLeave(
  request: LeaveRequestRecord,
  user: AuthenticatedUser | undefined,
  canApprove: boolean,
): boolean {
  return (
    user !== undefined &&
    canApprove &&
    request.status === LEAVE_STATUS_PENDING &&
    !isOwnLeaveRequest(request, user) &&
    !hasDecidedLeaveStep(request, user)
  );
}

/** The types a student request can use, as the filter's options; inactive ones stay, because
 * an old request may name one. */
export function toLeaveTypeOptions(types: readonly LeaveTypeRecord[]): LeaveTypeOption[] {
  return types
    .filter((type) => type.applies_to !== LEAVE_TYPE_STAFF_ONLY)
    .map((type) => ({ id: type.id, name: type.name }));
}

/** `days_count` ("1.0", "0.5") as a locale number with at most one decimal; the raw text if it
 * is not a number. */
export function formatLeaveDays(value: string, locale: string): string {
  const days = Number(value);
  if (Number.isNaN(days)) return value;
  const options = { maximumFractionDigits: LEAVE_DAYS_FRACTION_DIGITS };
  return new Intl.NumberFormat(locale, options).format(days);
}

/** A decision's toast: a `decision.*` message key under `attendance.leave`, and its values. */
export interface LeaveDecisionOutcome {
  key:
    | "reject.done"
    | "approve.done"
    | "approve.doneMarked"
    | "approve.doneNoneMarked"
    | "approve.doneNextLevel";
  /** `count` for the marked days, `level` for the next level; empty otherwise. */
  values: Record<string, number>;
}

/**
 * What a decision tells the approver. A rejection ends the request. An approval that is not the
 * last level leaves it pending, now at the next level, and marks no days. The last level
 * approves it, and the server says how many days it marked (fewer than the request covers when
 * a day was already marked or is not a school day).
 */
export function leaveDecisionOutcome(
  action: LeaveAction,
  { request, autoMarkedDays }: LeaveDecisionResult,
): LeaveDecisionOutcome {
  if (action === "reject") return { key: "reject.done", values: {} };
  if (request.status !== "approved") {
    return { key: "approve.doneNextLevel", values: { level: request.current_approval_level } };
  }
  if (autoMarkedDays === null) return { key: "approve.done", values: {} };
  return autoMarkedDays > 0
    ? { key: "approve.doneMarked", values: { count: autoMarkedDays } }
    : { key: "approve.doneNoneMarked", values: {} };
}

/**
 * Whether a step was never reached: still `pending` on a request that is no longer. A rejection
 * decides only the step it was made at, and a cancellation touches none, so the later levels
 * stay `pending` for good; the server never marks them `skipped`.
 */
export function isStepNotReached(step: LeaveApprovalRecord, requestStatus: LeaveStatus): boolean {
  return step.decision === "pending" && requestStatus !== LEAVE_STATUS_PENDING;
}

/** The message key naming a step's required permission, or undefined for a key with no label. */
export function stepPermissionLabelKey(permission: string): string | undefined {
  return Object.hasOwn(LEAVE_STEP_PERMISSION_LABELS, permission)
    ? LEAVE_STEP_PERMISSION_LABELS[permission]
    : undefined;
}
