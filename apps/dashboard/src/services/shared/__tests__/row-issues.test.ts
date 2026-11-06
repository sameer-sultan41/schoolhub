import { ApiError } from "@schoolhub/api-client";

import {
  ISSUE_DUPLICATE,
  ISSUE_NOT_ENROLLED,
  ISSUE_ON_LEAVE,
  ISSUE_SYSTEM_ONLY,
  ON_LEAVE_REFUSED_MESSAGE,
  onLeaveBulkMark,
  OTHER_STUDENT_ID,
  refusedBulkMark,
  STUDENT_ID,
  THIRD_STUDENT_ID,
} from "@/services/modules/student-attendance/__tests__/student-attendance-fixtures";
import {
  ABOVE_MAX_ISSUE,
  NOT_ON_ROLL_ISSUE,
  OTHER_STUDENT_ID as MARKS_OTHER_STUDENT_ID,
  refusedBulkEntry,
  STUDENT_ID as MARKS_STUDENT_ID,
} from "@/services/modules/marks/__tests__/marks-fixtures";

import { rowIssueRecordsFromError, rowIssuesFromError } from "../row-issues";

describe("rowIssuesFromError (attendance's :bulk-mark)", () => {
  it("maps each refused student to the server's sentence, from error.meta.rows", () => {
    const error = refusedBulkMark([
      { student_id: STUDENT_ID, issue: ISSUE_NOT_ENROLLED },
      { student_id: OTHER_STUDENT_ID, issue: ISSUE_DUPLICATE },
    ]);

    const issues = rowIssuesFromError(error);

    expect([...issues.entries()]).toEqual([
      [STUDENT_ID, ISSUE_NOT_ENROLLED],
      [OTHER_STUDENT_ID, ISSUE_DUPLICATE],
    ]);
  });

  it("reads the on-leave refusal, which comes with its own sentence", () => {
    const error = onLeaveBulkMark([OTHER_STUDENT_ID]);

    expect(error.fieldErrors().entries).toBe(ON_LEAVE_REFUSED_MESSAGE);
    expect(rowIssuesFromError(error).get(OTHER_STUDENT_ID)).toBe(ISSUE_ON_LEAVE);
  });

  it("carries the system-only status sentence for an on_leave row", () => {
    const error = refusedBulkMark([{ student_id: THIRD_STUDENT_ID, issue: ISSUE_SYSTEM_ONLY }]);

    expect(rowIssuesFromError(error).get(THIRD_STUDENT_ID)).toBe(ISSUE_SYSTEM_ONLY);
  });

  it("keeps the first issue when a student is named twice", () => {
    const error = refusedBulkMark([
      { student_id: THIRD_STUDENT_ID, issue: ISSUE_DUPLICATE },
      { student_id: THIRD_STUDENT_ID, issue: ISSUE_NOT_ENROLLED },
    ]);

    expect(rowIssuesFromError(error).get(THIRD_STUDENT_ID)).toBe(ISSUE_DUPLICATE);
  });

  it("is empty for an error without rows, malformed rows, or a non-API error", () => {
    const conflict = new ApiError({
      code: "conflict",
      message: "Some of these records are locked and must be changed through a correction request.",
      status: 409,
      url: "/student-attendance:bulk-mark",
    });

    expect(rowIssuesFromError(conflict).size).toBe(0);
    expect(rowIssuesFromError(refusedBulkMark("nope")).size).toBe(0);
    expect(rowIssuesFromError(refusedBulkMark([{ student_id: STUDENT_ID }, null])).size).toBe(0);
    expect(rowIssuesFromError(new Error("network")).size).toBe(0);
  });
});

describe("rowIssueRecordsFromError (marks' :bulk-entry)", () => {
  it("keeps each row's refused field beside its sentence", () => {
    const error = refusedBulkEntry(
      [
        { index: 0, student_id: MARKS_STUDENT_ID, field: "theory_marks", issue: ABOVE_MAX_ISSUE },
        {
          index: 1,
          student_id: MARKS_OTHER_STUDENT_ID,
          field: "student_id",
          issue: NOT_ON_ROLL_ISSUE,
        },
      ],
      2,
    );

    const records = rowIssueRecordsFromError(error);

    expect(records.get(MARKS_STUDENT_ID)).toMatchObject({
      field: "theory_marks",
      issue: ABOVE_MAX_ISSUE,
    });
    expect(records.get(MARKS_OTHER_STUDENT_ID)?.field).toBe("student_id");
    expect(rowIssuesFromError(error).get(MARKS_STUDENT_ID)).toBe(ABOVE_MAX_ISSUE);
  });

  it("drops a row whose field is not a string", () => {
    const error = refusedBulkMark([{ student_id: STUDENT_ID, issue: ISSUE_DUPLICATE, field: 3 }]);

    expect(rowIssueRecordsFromError(error).size).toBe(0);
  });
});
