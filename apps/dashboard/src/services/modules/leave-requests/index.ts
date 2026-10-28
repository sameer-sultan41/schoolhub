import { decideLeave, fetchLeavePage, fetchLeaveTypes } from "./leave-requests-service";

export const LeaveRequestsService = {
  fetchLeavePage,
  fetchLeaveTypes,
  decideLeave,
};
export type {
  LeaveAction,
  LeaveApprovalDecision,
  LeaveApprovalRecord,
  LeaveDayPart,
  LeaveDecisionResult,
  LeavePageQuery,
  LeaveRequestRecord,
  LeaveStatus,
  LeaveTypeOption,
  LeaveTypeRecord,
} from "./leave-requests-type";
