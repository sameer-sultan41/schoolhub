import { ApiError } from "@schoolhub/api-client";

import { CLASS_ID } from "@/test-fixtures/attendance-records";

import { ATTENDANCE_STATUSES, MARKABLE_STATUSES } from "../student-attendance-constant";
import {
  defaultRecordsRange,
  entryIssuesFromError,
  isMarkableStatus,
  lockFilterToIsLocked,
  rowIssuesFromError,
  shiftIsoDate,
  statusFilterToStatus,
  toAttendanceMode,
  toAttendanceQueryParams,
  toBulkMarkBody,
  toBulkMarkMeta,
  toRegisterMeta,
  withSavedRecords,
} from "../student-attendance-helper";
import {
  attendanceRecord,
  ISSUE_DUPLICATE,
  ISSUE_NOT_ENROLLED,
  ISSUE_ON_LEAVE,
  ISSUE_SYSTEM_ONLY,
  ON_LEAVE_REFUSED_MESSAGE,
  onLeaveBulkMark,
  OTHER_STUDENT_ID,
  PERIOD_ID,
  refusedBulkMark,
  registerEntry,
  registerMetaWire,
  SECTION_ID,
  SESSION_ID,
  STUDENT_ID,
  THIRD_STUDENT_ID,
} from "./student-attendance-fixtures";

describe("MARKABLE_STATUSES", () => {
  it("is every generated status except on_leave", () => {
    expect(MARKABLE_STATUSES).not.toContain("on_leave");
    expect(MARKABLE_STATUSES).toEqual(["present", "absent", "late", "half_day", "excused"]);
    expect(ATTENDANCE_STATUSES).toContain("on_leave");
  });
});

describe("toAttendanceQueryParams", () => {
  it("maps the camelCase filters to the API's names, dateFrom to date__gte", () => {
    const params = toAttendanceQueryParams({
      cursor: "abc",
      pageSize: 50,
      ordering: "-attendance_date",
      status: "absent",
      dateFrom: "2026-10-01",
      dateTo: "2026-10-31",
      classId: CLASS_ID,
      sectionId: SECTION_ID,
      studentId: STUDENT_ID,
      periodId: PERIOD_ID,
      academicSessionId: SESSION_ID,
    });

    expect(params).toEqual({
      page_size: 50,
      cursor: "abc",
      ordering: "-attendance_date",
      status: "absent",
      date__gte: "2026-10-01",
      date__lte: "2026-10-31",
      class_id: CLASS_ID,
      section_id: SECTION_ID,
      student_id: STUDENT_ID,
      period_id: PERIOD_ID,
      academic_session_id: SESSION_ID,
    });
  });

  it("leaves out blank and unset filters but keeps isLocked false", () => {
    const params = toAttendanceQueryParams({ search: "", date: undefined, isLocked: false });

    expect(params).not.toHaveProperty("search");
    expect(params).not.toHaveProperty("date");
    expect(params).toMatchObject({ is_locked: false });
  });
});

describe("toBulkMarkBody", () => {
  it("sends snake_case keys, a null period for daily mode, and only the entry keys set", () => {
    const body = toBulkMarkBody({
      sectionId: SECTION_ID,
      attendanceDate: "2026-10-23",
      periodId: null,
      entries: [
        { studentId: STUDENT_ID, status: "present" },
        { studentId: OTHER_STUDENT_ID, status: "late", checkInTime: "08:20:00", remarks: null },
      ],
    });

    expect(body).toEqual({
      section_id: SECTION_ID,
      attendance_date: "2026-10-23",
      period_id: null,
      entries: [
        { student_id: STUDENT_ID, status: "present" },
        { student_id: OTHER_STUDENT_ID, status: "late", check_in_time: "08:20:00", remarks: null },
      ],
    });
    expect(body).not.toHaveProperty("academic_session_id");
  });
});

describe("toRegisterMeta", () => {
  it("reads the server's meta keys", () => {
    expect(
      toRegisterMeta(
        registerMetaWire({
          attendance_mode: "period",
          is_locked: true,
          markable: false,
          unmarkable_reason: "holiday",
          holiday_name: "Eid",
        }),
      ),
    ).toEqual({
      attendanceMode: "period",
      isLocked: true,
      markable: false,
      unmarkableReason: "holiday",
      holidayName: "Eid",
      academicSessionId: SESSION_ID,
    });
  });

  it("reads session_closed as a reason", () => {
    expect(toRegisterMeta(registerMetaWire({ unmarkable_reason: "session_closed" }))).toMatchObject(
      { unmarkableReason: "session_closed" },
    );
  });

  it("falls to read-only daily for missing or unknown meta", () => {
    const fallback = {
      attendanceMode: "daily",
      isLocked: false,
      markable: false,
      unmarkableReason: null,
      holidayName: null,
      academicSessionId: null,
    };
    expect(toRegisterMeta(undefined)).toEqual(fallback);
    expect(
      toRegisterMeta({ attendance_mode: "hourly", unmarkable_reason: "locked", markable: "yes" }),
    ).toEqual(fallback);
  });
});

describe("isMarkableStatus", () => {
  it("accepts the five register statuses and refuses on_leave and blanks", () => {
    expect(MARKABLE_STATUSES.every((status) => isMarkableStatus(status))).toBe(true);
    expect(isMarkableStatus("on_leave")).toBe(false);
    expect(isMarkableStatus("")).toBe(false);
  });
});

describe("toAttendanceMode", () => {
  it("reads period, and anything else as the daily default", () => {
    expect(toAttendanceMode("period")).toBe("period");
    expect(toAttendanceMode("daily")).toBe("daily");
    expect(toAttendanceMode(undefined)).toBe("daily");
    expect(toAttendanceMode("hourly")).toBe("daily");
  });
});

describe("toBulkMarkMeta", () => {
  it("maps the server's counts, alerts_queued to alertsQueued", () => {
    expect(toBulkMarkMeta({ marked: 3, updated: 1, alerts_queued: 2 })).toEqual({
      marked: 3,
      updated: 1,
      alertsQueued: 2,
    });
  });

  it("counts a missing or non-numeric value as 0", () => {
    expect(toBulkMarkMeta(undefined)).toEqual({ marked: 0, updated: 0, alertsQueued: 0 });
    expect(toBulkMarkMeta({ marked: "3" })).toMatchObject({ marked: 0 });
  });
});

describe("rowIssuesFromError", () => {
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

describe("withSavedRecords", () => {
  it("puts each written record on its student's row and leaves the rest", () => {
    const other = registerEntry({ student_id: OTHER_STUDENT_ID, student_name: "Bilal Khan" });
    const written = attendanceRecord({ status: "absent" });
    const register = {
      entries: [registerEntry(), other],
      meta: toRegisterMeta(registerMetaWire()),
    };

    const next = withSavedRecords(register, [written]);

    expect(next.entries[0]?.record).toEqual(written);
    expect(next.entries[1]).toBe(other);
    expect(next.meta).toBe(register.meta);
  });
});

describe("entryIssuesFromError", () => {
  const LEAVES_EARLY = "A student cannot leave before they arrived.";

  it("puts a submitted row's field error on the student sent at that index", () => {
    const error = new ApiError({
      code: "validation_error",
      message: LEAVES_EARLY,
      status: 400,
      url: "/student-attendance:bulk-mark",
      // The server's flattening of DRF's `{"entries": {1: {"check_out_time": [...]}}}`.
      details: [{ field: "entries.1.check_out_time", issue: LEAVES_EARLY }],
    });

    const issues = entryIssuesFromError(error, [STUDENT_ID, OTHER_STUDENT_ID]);

    expect([...issues.entries()]).toEqual([[OTHER_STUDENT_ID, LEAVES_EARLY]]);
  });

  it("reads the list form of the path too", () => {
    const error = new ApiError({
      code: "validation_error",
      message: LEAVES_EARLY,
      status: 400,
      url: "/student-attendance:bulk-mark",
      details: [{ field: "entries[0].check_out_time", issue: LEAVES_EARLY }],
    });

    expect(entryIssuesFromError(error, [STUDENT_ID]).get(STUDENT_ID)).toBe(LEAVES_EARLY);
  });

  it("ignores the register's own fields, an index past the rows sent, and other errors", () => {
    const error = new ApiError({
      code: "validation_error",
      message: "Invalid",
      status: 400,
      url: "/student-attendance:bulk-mark",
      details: [
        { field: "period_id", issue: "Invalid" },
        { field: "entries.5.status", issue: "Invalid" },
      ],
    });

    expect(entryIssuesFromError(error, [STUDENT_ID]).size).toBe(0);
    expect(entryIssuesFromError(new Error("network"), [STUDENT_ID]).size).toBe(0);
  });
});

describe("the Records list's filters", () => {
  it("opens on the last 7 days, today included", () => {
    expect(defaultRecordsRange("2026-10-24")).toEqual({ from: "2026-10-18", to: "2026-10-24" });
  });

  it("shifts a date across a month and a year end, and a leap day", () => {
    expect(shiftIsoDate("2026-10-03", -6)).toBe("2026-09-27");
    expect(shiftIsoDate("2027-01-02", -6)).toBe("2026-12-27");
    expect(shiftIsoDate("2028-03-01", -1)).toBe("2028-02-29");
    expect(shiftIsoDate("2026-03-31", 1)).toBe("2026-04-01");
  });

  it("keeps the calendar date across a DST change in the local zone", () => {
    // Jest runs in America/New_York: DST starts 2026-03-08 and ends 2026-11-01.
    expect(shiftIsoDate("2026-03-08", 1)).toBe("2026-03-09");
    expect(shiftIsoDate("2026-03-09", -1)).toBe("2026-03-08");
    expect(shiftIsoDate("2026-11-01", 1)).toBe("2026-11-02");
    expect(shiftIsoDate("2026-11-02", -1)).toBe("2026-11-01");
    expect(shiftIsoDate("2026-10-24", 0)).toBe("2026-10-24");
  });

  it("turns the status choice into a status, with all meaning none", () => {
    expect(statusFilterToStatus("all")).toBeUndefined();
    expect(statusFilterToStatus("half_day")).toBe("half_day");
  });

  it("turns the locked choice into is_locked, keeping false as a real filter", () => {
    expect(lockFilterToIsLocked("all")).toBeUndefined();
    expect(lockFilterToIsLocked("locked")).toBe(true);
    expect(lockFilterToIsLocked("open")).toBe(false);
  });
});
