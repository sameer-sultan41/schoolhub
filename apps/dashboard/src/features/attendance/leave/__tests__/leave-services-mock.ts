import { servicesMock } from "@/test-fixtures/services-mock";

/** The `@/services` mock the Leave tests share (see `servicesMock`). */
export function leaveServicesMock() {
  return servicesMock({
    auth: ["fetchCurrentUser"],
    leaveRequests: ["fetchLeavePage", "fetchLeaveTypes", "decideLeave"],
    jobs: ["fetchFileDownloadUrl"],
  });
}
