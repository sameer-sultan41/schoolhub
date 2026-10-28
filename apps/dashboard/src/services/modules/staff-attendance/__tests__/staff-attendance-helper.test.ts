import {
  canCheckOut,
  clearsSavedTimes,
  defaultStaffHistoryRange,
  isMarkableStaffStatus,
  isSameStaffDraft,
  isStaffDraftChanged,
  rebaseStaffDraft,
  staffDraftFromRecord,
  staffStatusFilterToStatus,
  toMarkStaffInput,
  withSavedStaffRecord,
} from "../staff-attendance-helper";
import {
  OTHER_STAFF_ID,
  STAFF_ID,
  staffRecord,
  staffRegisterEntry,
} from "./staff-attendance-fixtures";

describe("isMarkableStaffStatus", () => {
  it("allows the four register statuses and refuses leave, holiday and a student-only one", () => {
    expect(["present", "absent", "late", "half_day"].every(isMarkableStaffStatus)).toBe(true);
    expect(isMarkableStaffStatus("on_leave")).toBe(false);
    expect(isMarkableStaffStatus("holiday")).toBe(false);
    expect(isMarkableStaffStatus("excused")).toBe(false);
  });
});

describe("staff row drafts", () => {
  it("starts an unmarked row blank, and a marked one from its record as HH:MM", () => {
    expect(staffDraftFromRecord(null)).toEqual({ status: "", checkInTime: "", remarks: "" });
    const late = staffRecord({ status: "late", check_in_time: "08:40:00", remarks: "Bus" });
    expect(staffDraftFromRecord(late)).toEqual({
      status: "late",
      checkInTime: "08:40",
      remarks: "Bus",
    });
  });

  it("starts a holiday row with no status, as the register can't set one", () => {
    expect(staffDraftFromRecord(staffRecord({ status: "holiday" })).status).toBe("");
  });

  it("has something to save once a status is picked, or a value differs from the record", () => {
    const record = staffRecord();
    const saved = staffDraftFromRecord(record);

    expect(isStaffDraftChanged({ status: "", checkInTime: "", remarks: "" }, null)).toBe(false);
    expect(isStaffDraftChanged({ status: "present", checkInTime: "", remarks: "" }, null)).toBe(
      true,
    );
    expect(isStaffDraftChanged(saved, record)).toBe(false);
    // Remarks are compared trimmed: a trailing space is not a change.
    expect(isStaffDraftChanged({ ...saved, remarks: " " }, record)).toBe(false);
    expect(isStaffDraftChanged({ ...saved, checkInTime: "08:05" }, record)).toBe(true);
    expect(isStaffDraftChanged({ ...saved, status: "late" }, record)).toBe(true);
  });
});

describe("a row whose record changed under it", () => {
  const before = { status: "present", checkInTime: "08:00", remarks: "" } as const;
  const after = { status: "present", checkInTime: "08:00", remarks: "Checked out early" } as const;

  it("takes the server's value for a field not edited, and keeps an unsaved edit", () => {
    const draft = { status: "late", checkInTime: "08:00", remarks: "" } as const;

    expect(rebaseStaffDraft(draft, before, after)).toEqual({
      status: "late",
      checkInTime: "08:00",
      remarks: "Checked out early",
    });
    expect(isSameStaffDraft(before, after)).toBe(false);
    expect(isSameStaffDraft(before, { ...before })).toBe(true);
  });

  it("says Absent clears the times only when the record holds one", () => {
    const absent = { status: "absent", checkInTime: "", remarks: "" } as const;

    expect(clearsSavedTimes(absent, staffRecord())).toBe(true);
    expect(clearsSavedTimes(absent, staffRecord({ check_in_time: null }))).toBe(false);
    expect(clearsSavedTimes(absent, null)).toBe(false);
    expect(clearsSavedTimes({ ...absent, status: "present" }, staffRecord())).toBe(false);
  });
});

describe("toMarkStaffInput", () => {
  it("sends the saved check-in itself, seconds kept, while its HH:MM is unchanged", () => {
    const entry = staffRegisterEntry({ record: staffRecord({ check_in_time: "08:03:27" }) });
    const draft = { status: "present", checkInTime: "08:03", remarks: "Note" } as const;

    expect(toMarkStaffInput(entry, "2026-10-23", draft).checkInTime).toBe("08:03:27");
    expect(
      toMarkStaffInput(entry, "2026-10-23", { ...draft, checkInTime: "08:05" }).checkInTime,
    ).toBe("08:05");
  });

  it("sends the saved check-out back, so the upsert keeps it", () => {
    const entry = staffRegisterEntry({ record: staffRecord({ check_out_time: "16:30:00" }) });

    expect(
      toMarkStaffInput(entry, "2026-10-23", {
        status: "late",
        checkInTime: "08:40",
        remarks: "  Bus late ",
      }),
    ).toEqual({
      staffId: STAFF_ID,
      attendanceDate: "2026-10-23",
      status: "late",
      checkInTime: "08:40",
      checkOutTime: "16:30:00",
      remarks: "Bus late",
    });
  });

  it("sends an absent day with no times, and blanks as null", () => {
    const entry = staffRegisterEntry({ record: staffRecord({ check_out_time: "16:30:00" }) });

    const draft = { status: "absent", checkInTime: "08:00", remarks: "" } as const;
    expect(toMarkStaffInput(entry, "2026-10-23", draft)).toEqual({
      staffId: STAFF_ID,
      attendanceDate: "2026-10-23",
      status: "absent",
      checkInTime: null,
      checkOutTime: null,
      remarks: null,
    });
  });
});

describe("canCheckOut", () => {
  it("offers check-out on a checked-in, unlocked row not yet checked out", () => {
    expect(canCheckOut(staffRecord())).toBe(true);
  });

  it.each([
    ["no record", null],
    ["no check-in", staffRecord({ check_in_time: null })],
    ["a locked row", staffRecord({ is_locked: true })],
    ["a row already checked out", staffRecord({ check_out_time: "16:30:00" })],
  ])("refuses %s", (_label, record) => {
    expect(canCheckOut(record)).toBe(false);
  });
});

describe("the register cache and the history filters", () => {
  it("replaces only the saved staff member's record", () => {
    const other = staffRegisterEntry({ staff_id: OTHER_STAFF_ID, staff_name: "Omar Farooq" });
    const saved = staffRecord({ status: "absent", check_in_time: null });

    const entries = withSavedStaffRecord([staffRegisterEntry(), other], saved);

    expect(entries[0]?.record).toEqual(saved);
    expect(entries[1]).toBe(other);
  });

  it("opens the history on the last 30 days, today included", () => {
    expect(defaultStaffHistoryRange("2026-10-31")).toEqual({
      from: "2026-10-02",
      to: "2026-10-31",
    });
  });

  it("reads 'all' as no status filter", () => {
    expect(staffStatusFilterToStatus("all")).toBeUndefined();
    expect(staffStatusFilterToStatus("holiday")).toBe("holiday");
  });
});
