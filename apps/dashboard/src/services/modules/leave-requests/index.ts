import {
  cancelLeave,
  createLeave,
  decideLeave,
  fetchLeavePage,
  fetchLeaveTypes,
} from "./leave-requests-service";

export const LeaveRequestsService = {
  fetchLeavePage,
  fetchLeaveTypes,
  decideLeave,
  createLeave,
  cancelLeave,
};
export type {
  LeaveAction,
  LeaveApprovalDecision,
  LeaveApprovalRecord,
  LeaveCreateInput,
  LeaveDayPart,
  LeaveDecisionResult,
  LeavePageQuery,
  LeaveRequestRecord,
  LeaveStatus,
  LeaveTypeOption,
  LeaveTypeRecord,
} from "./leave-requests-type";
