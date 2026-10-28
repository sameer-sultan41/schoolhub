import type { AuthenticatedUser } from "@schoolhub/types";

import { buildUser } from "@/test-utils";
import {
  canDecideLeave,
  formatLeaveDays,
  hasDecidedLeaveStep,
  isOwnLeaveRequest,
  isStepNotReached,
  leaveDecisionOutcome,
  stepPermissionLabelKey,
  toAutoMarkedDays,
  toLeaveQueryParams,
  toLeaveTypeOptions,
} from "../leave-requests-helper";
import {
  approvalStep,
  CASUAL_TYPE_ID,
  escalatedRecord,
  GUARDIAN_USER_ID,
  leaveRecord,
  leaveType,
  OTHER_APPROVER_ID,
  SICK_TYPE_ID,
  STAFF_TYPE_ID,
} from "./leave-requests-fixtures";

const SUBMITTER: AuthenticatedUser = { ...buildUser([]), id: GUARDIAN_USER_ID };
const APPROVER = buildUser(["attendance.leave-request.approve"]);

describe("toLeaveQueryParams", () => {
  it("maps each filter to the list's own param, the date range to date__gte and date__lte", () => {
    expect(
      toLeaveQueryParams({
        cursor: "c1",
        pageSize: 25,
        ordering: "-created_at",
        status: "pending",
        leaveTypeId: SICK_TYPE_ID,
        dateFrom: "2026-10-01",
        dateTo: "2026-10-31",
      }),
    ).toEqual({
      page_size: 25,
      cursor: "c1",
      ordering: "-created_at",
      status: "pending",
      leave_type_id: SICK_TYPE_ID,
      date__gte: "2026-10-01",
      date__lte: "2026-10-31",
    });
  });

  it("leaves out a filter that is not set", () => {
    expect(toLeaveQueryParams({ pageSize: 25, status: undefined, dateFrom: "" })).toEqual({
      page_size: 25,
    });
  });
});

describe("toAutoMarkedDays", () => {
  it("reads meta.auto_marked_days, and null when it is absent or not a number", () => {
    expect(toAutoMarkedDays({ auto_marked_days: 3 })).toBe(3);
    expect(toAutoMarkedDays({ auto_marked_days: 0 })).toBe(0);
    expect(toAutoMarkedDays({})).toBeNull();
    expect(toAutoMarkedDays(undefined)).toBeNull();
    expect(toAutoMarkedDays({ auto_marked_days: "3" })).toBeNull();
  });
});

describe("isOwnLeaveRequest", () => {
  it("is true only for the user who submitted it", () => {
    expect(isOwnLeaveRequest(leaveRecord(), SUBMITTER)).toBe(true);
    expect(isOwnLeaveRequest(leaveRecord(), APPROVER)).toBe(false);
    expect(isOwnLeaveRequest(leaveRecord(), undefined)).toBe(false);
  });
});

describe("hasDecidedLeaveStep", () => {
  it("is true for the approver of any decided level, not for one still waiting", () => {
    const request = escalatedRecord(APPROVER.id);

    expect(hasDecidedLeaveStep(request, APPROVER)).toBe(true);
    expect(hasDecidedLeaveStep(escalatedRecord(OTHER_APPROVER_ID), APPROVER)).toBe(false);
    expect(hasDecidedLeaveStep(leaveRecord({ approvals: [approvalStep()] }), APPROVER)).toBe(false);
    expect(hasDecidedLeaveStep(request, undefined)).toBe(false);
  });
});

describe("canDecideLeave", () => {
  it("offers a decision on a pending request from someone else, to an approver", () => {
    expect(canDecideLeave(leaveRecord(), APPROVER, true)).toBe(true);
  });

  it("offers it at level 2 to someone who decided no earlier level", () => {
    expect(canDecideLeave(escalatedRecord(OTHER_APPROVER_ID), APPROVER, true)).toBe(true);
  });

  it("refuses the submitter's own request", () => {
    expect(canDecideLeave(leaveRecord(), SUBMITTER, true)).toBe(false);
  });

  it("refuses someone who decided an earlier level", () => {
    expect(canDecideLeave(escalatedRecord(APPROVER.id), APPROVER, true)).toBe(false);
  });

  it("is the shared pending / key / user gate plus the submitter and earlier-level rules", () => {
    expect(canDecideLeave(leaveRecord({ status: "approved" }), APPROVER, true)).toBe(false);
    expect(canDecideLeave(leaveRecord(), APPROVER, false)).toBe(false);
    expect(canDecideLeave(leaveRecord(), undefined, true)).toBe(false);
  });
});

describe("isStepNotReached", () => {
  const waiting = approvalStep();

  it("is true for a step still pending on a rejected or cancelled request", () => {
    expect(isStepNotReached(waiting, "rejected")).toBe(true);
    expect(isStepNotReached(waiting, "cancelled")).toBe(true);
  });

  it("is false while the request is pending, whatever the step", () => {
    expect(isStepNotReached(waiting, "pending")).toBe(false);
  });

  it("is false for a step that was decided, on any request", () => {
    const rejected = approvalStep({ decision: "rejected", approver_id: OTHER_APPROVER_ID });

    expect(isStepNotReached(rejected, "rejected")).toBe(false);
    expect(isStepNotReached({ ...rejected, decision: "approved" }, "approved")).toBe(false);
  });
});

describe("toLeaveTypeOptions", () => {
  it("keeps the types a student can use, inactive ones included, and drops staff-only ones", () => {
    const options = toLeaveTypeOptions([
      leaveType({ id: SICK_TYPE_ID, name: "Sick leave", applies_to: "both" }),
      leaveType({
        id: CASUAL_TYPE_ID,
        name: "Family event",
        applies_to: "student",
        is_active: false,
      }),
      leaveType({ id: STAFF_TYPE_ID, name: "Study leave", applies_to: "staff" }),
    ]);

    expect(options).toEqual([
      { id: SICK_TYPE_ID, name: "Sick leave" },
      { id: CASUAL_TYPE_ID, name: "Family event" },
    ]);
  });
});

describe("formatLeaveDays", () => {
  it("shows whole and half days without a trailing zero", () => {
    expect(formatLeaveDays("3.0", "en")).toBe("3");
    expect(formatLeaveDays("0.5", "en")).toBe("0.5");
    expect(formatLeaveDays("12.0", "en")).toBe("12");
  });

  it("returns text that is not a number as it came", () => {
    expect(formatLeaveDays("n/a", "en")).toBe("n/a");
  });
});

describe("leaveDecisionOutcome", () => {
  const approved = leaveRecord({ status: "approved" });

  it("tells a rejection plainly, whatever the server counted", () => {
    expect(
      leaveDecisionOutcome("reject", {
        request: leaveRecord({ status: "rejected" }),
        autoMarkedDays: 0,
      }),
    ).toEqual({ key: "reject.done", values: {} });
  });

  it("gives the days an approval marked", () => {
    expect(leaveDecisionOutcome("approve", { request: approved, autoMarkedDays: 3 })).toEqual({
      key: "approve.doneMarked",
      values: { count: 3 },
    });
  });

  it("says no day was marked when the server marked none", () => {
    expect(leaveDecisionOutcome("approve", { request: approved, autoMarkedDays: 0 })).toEqual({
      key: "approve.doneNoneMarked",
      values: {},
    });
  });

  it("only says approved when the server sent no count", () => {
    expect(leaveDecisionOutcome("approve", { request: approved, autoMarkedDays: null })).toEqual({
      key: "approve.done",
      values: {},
    });
  });

  it("says the request moved to the next level when level 1 approved a two-level chain", () => {
    const next = escalatedRecord(APPROVER.id);

    expect(leaveDecisionOutcome("approve", { request: next, autoMarkedDays: 0 })).toEqual({
      key: "approve.doneNextLevel",
      values: { level: 2 },
    });
  });
});

describe("stepPermissionLabelKey", () => {
  it("names the leave approve key's label", () => {
    expect(stepPermissionLabelKey("attendance.leave-request.approve")).toBe("leaveApprove");
  });

  it("has no label for an unknown key, or for an inherited property name", () => {
    expect(stepPermissionLabelKey("attendance.leave.audit")).toBeUndefined();
    expect(stepPermissionLabelKey("constructor")).toBeUndefined();
  });
});
