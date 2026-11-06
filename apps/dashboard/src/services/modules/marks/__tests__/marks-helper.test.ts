import {
  markIssue,
  needsUnlockToEdit,
  progressState,
  toMarkInput,
  toMarksGridMeta,
} from "../marks-helper";
import { progressRow } from "./marks-fixtures";

describe("toMarksGridMeta", () => {
  it("falls to read-only on a missing or malformed meta", () => {
    expect(toMarksGridMeta(undefined)).toEqual({
      examSubject: { maxMarks: "", passMarks: "", hasPractical: false, practicalMaxMarks: null },
      writable: false,
      unwritableReason: null,
      unwritableMessage: null,
    });
    expect(
      toMarksGridMeta({ writable: "yes", unwritable_reason: "elsewhere", exam_subject: 3 }),
    ).toMatchObject({ writable: false, unwritableReason: null });
  });

  it("reads every reason the server sends", () => {
    for (const reason of [
      "exam_status",
      "window_not_open",
      "window_closed",
      "locked",
      "no_permission",
    ]) {
      expect(toMarksGridMeta({ unwritable_reason: reason }).unwritableReason).toBe(reason);
    }
  });
});

describe("toMarkInput", () => {
  it("drops the wire decimal's trailing zeros, and shows null as blank", () => {
    expect(toMarkInput("45.50")).toBe("45.5");
    expect(toMarkInput("100.00")).toBe("100");
    expect(toMarkInput("7")).toBe("7");
    expect(toMarkInput(null)).toBe("");
  });
});

describe("markIssue", () => {
  it("accepts a blank, a whole number and up to two decimals within the maximum", () => {
    expect(markIssue("", "100.00")).toBeNull();
    expect(markIssue("100", "100.00")).toBeNull();
    expect(markIssue("99.75", "100.00")).toBeNull();
  });

  it("calls anything the server can't parse invalid", () => {
    expect(markIssue("abc", "100.00")).toBe("invalid");
    expect(markIssue("-1", "100.00")).toBe("invalid");
    expect(markIssue("45.555", "100.00")).toBe("invalid");
    expect(markIssue("4.", "100.00")).toBe("invalid");
    expect(markIssue("12345", "100.00")).toBe("invalid");
    expect(markIssue("9999.99", null)).toBeNull();
  });

  it("flags a mark above the maximum, and checks none without one", () => {
    expect(markIssue("100.5", "100.00")).toBe("aboveMax");
    expect(markIssue("100.5", null)).toBeNull();
  });
});

describe("progressState", () => {
  it("reads locked first, then all submitted, then any entered", () => {
    expect(progressState(progressRow({ is_locked: true, submitted: 2 }))).toBe("locked");
    expect(progressState(progressRow({ entered: 2, submitted: 2 }))).toBe("submitted");
    expect(progressState(progressRow())).toBe("inProgress");
    expect(progressState(progressRow({ entered: 0 }))).toBe("notStarted");
    expect(progressState(progressRow({ expected: 0, entered: 0, submitted: 0 }))).toBe(
      "notStarted",
    );
  });
});

describe("needsUnlockToEdit", () => {
  it("holds only while the exam takes marks and a subject is still locked", () => {
    const locked = [progressRow(), progressRow({ is_locked: true })];
    expect(needsUnlockToEdit("marks_entry", locked)).toBe(true);
    expect(needsUnlockToEdit("processing", locked)).toBe(false);
    expect(needsUnlockToEdit("marks_entry", [progressRow()])).toBe(false);
  });
});
