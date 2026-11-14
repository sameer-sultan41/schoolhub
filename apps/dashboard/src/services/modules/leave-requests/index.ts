import {
  cancelLeave,
  createLeave,
  decideLeave,
  fetchLeaveAttachmentUrl,
  fetchLeavePage,
  fetchLeaveTypes,
} from "./leave-requests-service";

export const LeaveRequestsService = {
  fetchLeavePage,
  fetchLeaveTypes,
  decideLeave,
  createLeave,
  cancelLeave,
  fetchLeaveAttachmentUrl,
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
