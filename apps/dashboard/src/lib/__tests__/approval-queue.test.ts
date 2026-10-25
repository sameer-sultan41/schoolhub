import { buildUser } from "@/test-utils";
import {
  APPROVAL_STATUS_PENDING,
  canDecidePending,
  isViewer,
  statusesOf,
  statusFilterValue,
  toDecisionBody,
} from "../approval-queue";

const USER = buildUser(["attendance.correction.approve"]);

describe("toDecisionBody", () => {
  it("sends the trimmed note under the queue's own key", () => {
    expect(toDecisionBody("review_note", "  Checked the gate log ")).toEqual({
      review_note: "Checked the gate log",
    });
    expect(toDecisionBody("note", "  Seen the medical note ")).toEqual({
      note: "Seen the medical note",
    });
  });

  it("sends an empty body for a blank or missing note", () => {
    expect(toDecisionBody("note", "   ")).toEqual({});
    expect(toDecisionBody("note")).toEqual({});
  });
});

describe("statusesOf", () => {
  it("lists the keys of the status set", () => {
    expect(statusesOf({ pending: true, approved: true })).toEqual(["pending", "approved"]);
  });
});

describe("statusFilterValue", () => {
  it("reads All as no status and any other value as that status", () => {
    expect(statusFilterValue("all")).toBeUndefined();
    expect(statusFilterValue("rejected")).toBe("rejected");
  });
});

describe("isViewer", () => {
  it("is true only for the user whose id it is", () => {
    expect(isViewer(USER.id, USER)).toBe(true);
    expect(isViewer("someone-else", USER)).toBe(false);
    expect(isViewer(USER.id, undefined)).toBe(false);
  });
});

describe("canDecidePending", () => {
  const pending = { status: APPROVAL_STATUS_PENDING };

  it("allows a loaded user with the approve key on a pending request", () => {
    expect(canDecidePending(pending, USER, true)).toBe(true);
  });

  it.each(["approved", "rejected", "cancelled"])("refuses a %s request", (status) => {
    expect(canDecidePending({ status }, USER, true)).toBe(false);
  });

  it("refuses without the approve key, and while the user is still loading", () => {
    expect(canDecidePending(pending, USER, false)).toBe(false);
    expect(canDecidePending(pending, undefined, true)).toBe(false);
  });
});
