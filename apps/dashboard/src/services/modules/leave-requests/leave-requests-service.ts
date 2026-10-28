import { fetchPage, MAX_PAGE_SIZE } from "@schoolhub/api-client";
import type { Page } from "@schoolhub/types";
import { apiClient } from "@/lib/auth";
import { fetchApprovalPage, postApprovalDecision } from "@/services/approval-queue";
import { endpoints } from "@/services/endpoints";
import { LEAVE_NOTE_FIELD } from "./leave-requests-constant";
import { toAutoMarkedDays, toLeaveQueryParams } from "./leave-requests-helper";
import type {
  LeaveAction,
  LeaveDecisionResult,
  LeavePageQuery,
  LeaveRequestRecord,
  LeaveTypeRecord,
} from "./leave-requests-type";

/** The leave queue's API calls (`/leave-requests`, `/leave-types`), reached through
 * `Services.leaveRequests.*`. Review only: a request is submitted by its student or guardian. */

/** One cursor page of leave requests: the caller's scope decides which they may see. */
export async function fetchLeavePage(query: LeavePageQuery): Promise<Page<LeaveRequestRecord>> {
  return fetchApprovalPage<LeaveRequestRecord>(
    endpoints.leaveRequests.list,
    toLeaveQueryParams(query),
  );
}

/** The leave-type catalogue, by name. One `MAX_PAGE_SIZE` page: a school has a handful. */
export async function fetchLeaveTypes(): Promise<LeaveTypeRecord[]> {
  const { items } = await fetchPage<LeaveTypeRecord>(apiClient, endpoints.leaveTypes.list, {
    query: { ordering: "name", page_size: MAX_PAGE_SIZE },
  });
  return items;
}

/** `:approve` or `:reject` the request's current step, each with an optional note. Answers with
 * the request as it now stands and the days an approval marked. A request already decided is a
 * 409; a step the caller may not take (their own request, a second level) is a 422. */
export async function decideLeave(
  id: string,
  action: LeaveAction,
  note?: string,
): Promise<LeaveDecisionResult> {
  const { data, meta } = await postApprovalDecision<LeaveRequestRecord>(
    endpoints.leaveRequests.action(id, action),
    LEAVE_NOTE_FIELD,
    note,
  );
  return { request: data, autoMarkedDays: toAutoMarkedDays(meta) };
}
