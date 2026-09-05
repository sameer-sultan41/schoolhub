import {
  CONFLICT_SEVERITY_VARIANT,
  DEFAULT_VISIBLE_WEEKDAYS,
  SUBSTITUTION_STATUSES,
  SUBSTITUTION_STATUS_BADGE,
  WEEKDAYS,
  weekdayFromIsoDate,
} from "@/features/timetable/timetable-constants";

describe("weekdayFromIsoDate", () => {
  it("returns Monday-based weekdays, matching the API's day_of_week", () => {
    // 2026-09-07 is a Monday.
    expect(weekdayFromIsoDate("2026-09-07")).toBe(0);
    expect(weekdayFromIsoDate("2026-09-11")).toBe(4);
    expect(weekdayFromIsoDate("2026-09-12")).toBe(5);
    // Sunday is 6 here and 0 in JavaScript's own getDay() — the conversion this
    // helper exists for.
    expect(weekdayFromIsoDate("2026-09-13")).toBe(6);
  });

  it("returns null for an empty or unparseable value", () => {
    expect(weekdayFromIsoDate("")).toBeNull();
    expect(weekdayFromIsoDate("not-a-date")).toBeNull();
  });
});

describe("timetable constants", () => {
  it("covers all seven weekdays and shows Monday to Friday by default", () => {
    expect(WEEKDAYS).toHaveLength(7);
    expect([...DEFAULT_VISIBLE_WEEKDAYS]).toEqual([0, 1, 2, 3, 4]);
  });

  it("gives every substitution status a badge variant", () => {
    for (const status of SUBSTITUTION_STATUSES) {
      expect(SUBSTITUTION_STATUS_BADGE[status]).toBeDefined();
    }
  });

  it("reads a hard conflict as an error and a soft one as a warning", () => {
    expect(CONFLICT_SEVERITY_VARIANT.hard).toBe("danger");
    expect(CONFLICT_SEVERITY_VARIANT.soft).toBe("warning");
  });
});
