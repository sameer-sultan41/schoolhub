import { readConflicts, type TimetableConflict } from "@/features/timetable/timetable-types";

const HARD: TimetableConflict = {
  type: "teacher_double_booked",
  severity: "hard",
  slot_ids: ["slot1", "slot2"],
  message: "This teacher is already teaching in this period.",
};

const SOFT: TimetableConflict = {
  type: "room_over_capacity",
  severity: "soft",
  slot_ids: ["slot3"],
  message: "This room seats 20; the section has 31 students.",
};

describe("readConflicts", () => {
  it("reads a bare array, which is what a `:validate` run may answer with", () => {
    expect(readConflicts([HARD, SOFT])).toEqual([HARD, SOFT]);
  });

  it("reads the `conflicts` key, which is what a slot write's meta and a publish body carry", () => {
    expect(readConflicts({ conflicts: [HARD] })).toEqual([HARD]);
  });

  it("reads `meta` shaped objects that also carry unrelated keys", () => {
    expect(readConflicts({ pagination: { next_cursor: null }, conflicts: [SOFT] })).toEqual([SOFT]);
  });

  it("returns an empty list rather than throwing for anything unrecognisable", () => {
    expect(readConflicts(undefined)).toEqual([]);
    expect(readConflicts(null)).toEqual([]);
    expect(readConflicts("nope")).toEqual([]);
    expect(readConflicts({})).toEqual([]);
    expect(readConflicts({ conflicts: "nope" })).toEqual([]);
  });

  it("drops entries that are not conflicts instead of letting them reach the grid", () => {
    expect(
      readConflicts([HARD, { type: "x" }, null, { ...SOFT, severity: "catastrophic" }]),
    ).toEqual([HARD]);
  });
});
