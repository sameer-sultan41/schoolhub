import type { AuthenticatedUser } from "@schoolhub/types";

import { staffRecord } from "@/services/modules/staff-attendance/__tests__/staff-attendance-fixtures";
import { isMarkableStaffStatus } from "@/services/modules/staff-attendance/staff-attendance-helper";
import { buildUser } from "@/test-utils";
import { STAFF_CORRECTION_CHANGE_FIELDS } from "../attendance-corrections-constant";
import {
  buildCorrectionNewValues,
  canDecideCorrection,
  correctionChanges,
  correctionSubjectName,
  isOwnAttendanceCorrection,
  isOwnCorrection,
  mineFilterToMine,
  recordToCorrectionValues,
  statusFilterToStatus,
  toCorrectionBody,
  toCorrectionQueryParams,
  toDecisionBody,
} from "../attendance-corrections-helper";
import { correctionRecord, REQUESTER_ID } from "./attendance-corrections-fixtures";

const REQUESTER: AuthenticatedUser = { ...buildUser([]), id: REQUESTER_ID };
const APPROVER = buildUser(["attendance.correction.approve"]);
const SUBJECT_ID = "88888888-aaaa-4bbb-8ccc-000000000001";

describe("correctionChanges", () => {
  it("lists only the fields that differ, in the form's order", () => {
    expect(correctionChanges(correctionRecord())).toEqual([
      { field: "status", from: "late", to: "present" },
      { field: "remarks", from: null, to: "Gate log" },
    ]);
  });

  it("shows a time as HH:MM and a cleared value as null", () => {
    const changes = correctionChanges(
      correctionRecord({
        old_values: { check_in_time: "08:20:00", check_out_time: "13:00:00" },
        new_values: { check_in_time: "08:05:00", check_out_time: null },
      }),
    );

    expect(changes).toEqual([
      { field: "check_in_time", from: "08:20", to: "08:05" },
      { field: "check_out_time", from: "13:00", to: null },
    ]);
  });

  it("ignores a field the proposal does not name, and any key that is not correctable", () => {
    const changes = correctionChanges(
      correctionRecord({
        old_values: { status: "late", remarks: "Old", marked_by: "someone" },
        new_values: { status: "present", marked_by: "someone-else" },
      }),
    );

    expect(changes).toEqual([{ field: "status", from: "late", to: "present" }]);
  });

  it("reads a malformed payload as no change instead of throwing", () => {
    expect(correctionChanges(correctionRecord({ old_values: null, new_values: "x" }))).toEqual([]);
  });
});

describe("canDecideCorrection", () => {
  const pending = correctionRecord();

  it("allows an approver on a pending request from someone else", () => {
    expect(canDecideCorrection(pending, APPROVER, true)).toBe(true);
  });

  it("refuses the approver's own request", () => {
    expect(isOwnCorrection(pending, REQUESTER)).toBe(true);
    expect(canDecideCorrection(pending, REQUESTER, true)).toBe(false);
  });

  it("refuses a correction to the approver's own attendance, raised by someone else", () => {
    const aboutApprover = correctionRecord({ subject_type: "staff", subject_user_id: APPROVER.id });

    expect(isOwnAttendanceCorrection(aboutApprover, APPROVER)).toBe(true);
    expect(canDecideCorrection(aboutApprover, APPROVER, true)).toBe(false);
  });

  it("allows an approver on a staff correction about someone else", () => {
    const aboutOther = correctionRecord({ subject_type: "staff", subject_user_id: SUBJECT_ID });

    expect(isOwnAttendanceCorrection(aboutOther, APPROVER)).toBe(false);
    expect(canDecideCorrection(aboutOther, APPROVER, true)).toBe(true);
  });

  it.each(["approved", "rejected", "cancelled"] as const)("refuses a %s request", (status) => {
    expect(canDecideCorrection(correctionRecord({ status }), APPROVER, true)).toBe(false);
  });

  it("refuses without the approve key, and while the user is still loading", () => {
    expect(canDecideCorrection(pending, APPROVER, false)).toBe(false);
    expect(canDecideCorrection(pending, undefined, true)).toBe(false);
    expect(isOwnCorrection(pending, undefined)).toBe(false);
  });
});

describe("query mapping", () => {
  it("maps the filters, keeping mine=false and dropping blanks", () => {
    expect(
      toCorrectionQueryParams({
        cursor: "c2",
        pageSize: 25,
        ordering: "-created_at",
        status: "pending",
        mine: false,
      }),
    ).toEqual({
      page_size: 25,
      cursor: "c2",
      ordering: "-created_at",
      status: "pending",
      mine: false,
    });
    expect(toCorrectionQueryParams({ pageSize: 25 })).toEqual({ page_size: 25 });
  });

  it("reads 'all' as no status, and an off Mine as no filter", () => {
    expect(statusFilterToStatus("all")).toBeUndefined();
    expect(statusFilterToStatus("rejected")).toBe("rejected");
    expect(mineFilterToMine("true")).toBe(true);
    expect(mineFilterToMine("")).toBeUndefined();
  });

  it("sends the note when there is one and an empty body otherwise", () => {
    expect(toDecisionBody("  Checked the gate log ")).toEqual({
      review_note: "Checked the gate log",
    });
    expect(toDecisionBody("   ")).toEqual({});
    expect(toDecisionBody()).toEqual({});
  });
});

describe("a staff target", () => {
  const locked = staffRecord({
    status: "late",
    check_in_time: "08:40:00",
    check_out_time: "12:30:00",
    remarks: "Traffic",
    is_locked: true,
  });

  it("names the staff row in the body, and only it", () => {
    expect(
      toCorrectionBody({
        staffAttendanceId: locked.id,
        newValues: { check_in_time: "08:05" },
        reason: "Gate log",
      }),
    ).toEqual({
      staff_attendance_id: locked.id,
      new_values: { check_in_time: "08:05" },
      reason: "Gate log",
    });
  });

  it("never proposes remarks for a staff row, whatever the form holds", () => {
    const values = recordToCorrectionValues(locked, isMarkableStaffStatus);
    values.new_values.remarks = "Changed";
    values.new_values.check_out_time = "13:00";

    expect(buildCorrectionNewValues(values, locked, STAFF_CORRECTION_CHANGE_FIELDS)).toEqual({
      check_out_time: "13:00",
    });
  });

  it("starts a holiday row's status blank, as no correction may set it", () => {
    const holiday = staffRecord({ status: "holiday" });

    expect(recordToCorrectionValues(holiday, isMarkableStaffStatus).new_values.status).toBe("");
  });

  it("names whose row a correction is for: the student, else the staff member", () => {
    expect(correctionSubjectName(correctionRecord())).toBe("Amna Raza");
    const staff = correctionRecord({
      subject_type: "staff",
      student_name: null,
      staff_name: "Nadia Hussain",
    });
    expect(correctionSubjectName(staff)).toBe("Nadia Hussain");
  });
});
