import type { MyTimetableSlot, PeriodRecord } from "@/features/timetable/timetable-types";
import { markerPercent, timeToMinutes, toIsoDate, toSchoolDay, weekdayOf } from "./use-school-day";

// Only the pure exports are under test here, but importing the module pulls in the hook,
// and through it `@/lib/auth`, which builds a real ApiClient at module scope — and that
// binds `globalThis.fetch`, which jsdom does not provide. Mocking the module keeps this
// suite about the time arithmetic rather than about the transport.
jest.mock("@/lib/auth", () => ({ apiClient: { get: jest.fn() } }));

/** Wednesday 2026-09-09, 10:20 local — mid-morning, inside the third period below. */
const WEDNESDAY_MID_MORNING = new Date(2026, 8, 9, 10, 20);
/** `day_of_week` is Monday-based (Python's `date.weekday()`), so Wednesday is 2. */
const WEDNESDAY = 2;

function makeSlot(overrides: Partial<MyTimetableSlot> = {}): MyTimetableSlot {
  return {
    id: "slot-1",
    day_of_week: WEDNESDAY,
    period_id: "p2",
    period_name: "Period 2",
    period_sequence: 2,
    start_time: "10:00:00",
    end_time: "10:45:00",
    section_id: "sec-1",
    section_name: "Grade 5-A",
    subject_id: "sub-1",
    subject_name: "Mathematics",
    staff_id: "staff-1",
    staff_name: "Ayesha Khan",
    room_id: "room-1",
    room_name: "Room 12",
    notes: null,
    substitution: null,
    ...overrides,
  };
}

function makePeriod(overrides: Partial<PeriodRecord> = {}): PeriodRecord {
  return {
    id: "p1",
    campus_id: null,
    name: "Period 1",
    sequence: 1,
    start_time: "09:00:00",
    end_time: "09:45:00",
    is_break: false,
    weekdays: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("timeToMinutes", () => {
  it("converts a DRF TimeField to minutes since midnight", () => {
    expect(timeToMinutes("08:45:00")).toBe(525);
    expect(timeToMinutes("00:00:00")).toBe(0);
    expect(timeToMinutes("23:59:59")).toBe(1439);
  });

  it("accepts a seconds-less time rather than assuming the serializer's shape", () => {
    expect(timeToMinutes("07:30")).toBe(450);
  });

  it("answers null — never NaN — for anything that is not a time of day", () => {
    expect(timeToMinutes("")).toBeNull();
    expect(timeToMinutes(null)).toBeNull();
    expect(timeToMinutes(undefined)).toBeNull();
    expect(timeToMinutes("half past nine")).toBeNull();
    expect(timeToMinutes("24:00:00")).toBeNull();
    expect(timeToMinutes("09:75:00")).toBeNull();
  });
});

describe("weekdayOf / toIsoDate", () => {
  it("shifts JavaScript's Sunday-based weekday onto the API's Monday-based one", () => {
    expect(weekdayOf(new Date(2026, 8, 7))).toBe(0); // Monday
    expect(weekdayOf(new Date(2026, 8, 9))).toBe(2); // Wednesday
    expect(weekdayOf(new Date(2026, 8, 13))).toBe(6); // Sunday
  });

  it("formats the viewer's LOCAL calendar date, not a UTC one", () => {
    // 23:30 local on the 9th is the 10th in UTC anywhere east of the meridian; "today"
    // for a person reading a dashboard is the date on their own wall.
    expect(toIsoDate(new Date(2026, 8, 9, 23, 30))).toBe("2026-09-09");
    expect(toIsoDate(new Date(2026, 0, 5))).toBe("2026-01-05");
  });
});

describe("toSchoolDay", () => {
  it("returns an empty but valid day when nothing is scheduled", () => {
    const day = toSchoolDay([], [], WEDNESDAY_MID_MORNING);

    expect(day.blocks).toEqual([]);
    expect(day.dayStartMinutes).toBe(0);
    expect(day.dayEndMinutes).toBe(0);
    expect(day.currentBlockKey).toBeNull();
    expect(day.nowMinutes).toBe(620);
  });

  it("keeps only today's rows and orders the day by start time", () => {
    const day = toSchoolDay(
      [
        makeSlot({
          id: "a",
          period_id: "p3",
          period_name: "Period 3",
          start_time: "11:00:00",
          end_time: "11:45:00",
        }),
        makeSlot({
          id: "b",
          period_id: "p1",
          period_name: "Period 1",
          start_time: "09:00:00",
          end_time: "09:45:00",
        }),
        makeSlot({ id: "c", period_id: "p9", period_name: "Thursday only", day_of_week: 3 }),
      ],
      [],
      WEDNESDAY_MID_MORNING,
    );

    expect(day.blocks.map((block) => block.label)).toEqual(["Period 1", "Period 3"]);
    expect(day.dayStartMinutes).toBe(540);
    expect(day.dayEndMinutes).toBe(705);
  });

  it("names the current block, and names none between periods", () => {
    const slots = [
      makeSlot({ id: "a", period_id: "p1", start_time: "09:00:00", end_time: "09:45:00" }),
      makeSlot({ id: "b", period_id: "p2", start_time: "10:00:00", end_time: "10:45:00" }),
    ];

    expect(toSchoolDay(slots, [], WEDNESDAY_MID_MORNING).currentBlockKey).toBe("p2");
    // 09:50 — after the first period, before the second. A dashboard that rounds this to
    // "you are in period 2" sends someone to a room five minutes early every day.
    expect(toSchoolDay(slots, [], new Date(2026, 8, 9, 9, 50)).currentBlockKey).toBeNull();
    // Half-open: 09:45 sharp is the end of the first period, not still inside it.
    expect(toSchoolDay(slots, [], new Date(2026, 8, 9, 9, 45)).currentBlockKey).toBeNull();
    // And the start of a period is inside it.
    expect(toSchoolDay(slots, [], new Date(2026, 8, 9, 10, 0)).currentBlockKey).toBe("p2");
  });

  it("composes the detail line from the parts that are present", () => {
    const [full] = toSchoolDay([makeSlot()], [], WEDNESDAY_MID_MORNING).blocks;
    expect(full?.detail).toBe("Grade 5-A · Mathematics · Ayesha Khan · Room 12");

    const [sparse] = toSchoolDay(
      [makeSlot({ subject_name: null, staff_name: null, room_name: "" })],
      [],
      WEDNESDAY_MID_MORNING,
    ).blocks;
    expect(sparse?.detail).toBe("Grade 5-A");
  });

  it("lets a confirmed substitution win the teacher AND the room", () => {
    const [block] = toSchoolDay(
      [
        makeSlot({
          substitution: {
            id: "sub-1",
            date: "2026-09-09",
            absent_staff_id: "staff-1",
            substitute_staff_id: "staff-2",
            substitute_staff_name: "Bilal Ahmed",
            room_id: "room-9",
            room_name: "Room 9",
            reason: "Sick leave",
          },
        }),
      ],
      [],
      WEDNESDAY_MID_MORNING,
    ).blocks;

    expect(block?.isSubstituted).toBe(true);
    expect(block?.detail).toBe("Grade 5-A · Mathematics · Bilal Ahmed · Room 9");
  });

  it("keeps the slot's own room when the substitution names none", () => {
    const [block] = toSchoolDay(
      [
        makeSlot({
          substitution: {
            id: "sub-1",
            date: "2026-09-09",
            absent_staff_id: "staff-1",
            substitute_staff_id: "staff-2",
            substitute_staff_name: "Bilal Ahmed",
            room_id: null,
            room_name: null,
            reason: null,
          },
        }),
      ],
      [],
      WEDNESDAY_MID_MORNING,
    ).blocks;

    expect(block?.detail).toBe("Grade 5-A · Mathematics · Bilal Ahmed · Room 12");
  });

  it("takes breaks and free periods from the bell schedule, which the timetable never returns", () => {
    const day = toSchoolDay(
      [makeSlot({ period_id: "p2", start_time: "10:00:00", end_time: "10:45:00" })],
      [
        makePeriod({ id: "p1", name: "Period 1", start_time: "09:00:00", end_time: "09:45:00" }),
        makePeriod({
          id: "break",
          name: "Morning break",
          sequence: 2,
          start_time: "09:45:00",
          end_time: "10:00:00",
          is_break: true,
        }),
        makePeriod({
          id: "p2",
          name: "Period 2",
          sequence: 3,
          start_time: "10:00:00",
          end_time: "10:45:00",
        }),
      ],
      WEDNESDAY_MID_MORNING,
    );

    expect(day.blocks.map((block) => [block.label, block.isBreak, block.detail])).toEqual([
      ["Period 1", false, null],
      ["Morning break", true, null],
      ["Period 2", false, "Grade 5-A · Mathematics · Ayesha Khan · Room 12"],
    ]);
    expect(day.currentBlockKey).toBe("p2");
  });

  it("drops a period that does not run today, keeping one whose weekdays are null", () => {
    const day = toSchoolDay(
      [],
      [
        makePeriod({ id: "everyday", name: "Assembly", weekdays: null }),
        makePeriod({
          id: "friday",
          name: "Jumu'ah",
          weekdays: [4],
          start_time: "12:00:00",
          end_time: "13:30:00",
        }),
      ],
      WEDNESDAY_MID_MORNING,
    );

    expect(day.blocks.map((block) => block.label)).toEqual(["Assembly"]);
  });

  it("skips a row whose times are unusable instead of drawing a block of no width", () => {
    const day = toSchoolDay(
      [
        makeSlot({ id: "bad", period_id: "px", start_time: "not-a-time", end_time: "10:45:00" }),
        makeSlot({
          id: "backwards",
          period_id: "py",
          start_time: "11:00:00",
          end_time: "11:00:00",
        }),
        makeSlot({
          id: "good",
          period_id: "pz",
          period_name: "Period 4",
          start_time: "12:00:00",
          end_time: "12:45:00",
        }),
      ],
      [makePeriod({ id: "p-ends-before-it-starts", start_time: "09:00:00", end_time: "08:00:00" })],
      WEDNESDAY_MID_MORNING,
    );

    expect(day.blocks.map((block) => block.label)).toEqual(["Period 4"]);
  });

  it("takes the first row per period rather than stacking duplicates", () => {
    const day = toSchoolDay(
      [
        makeSlot({ id: "a", subject_name: "Mathematics" }),
        makeSlot({ id: "b", subject_name: "Physics" }),
      ],
      [],
      WEDNESDAY_MID_MORNING,
    );

    expect(day.blocks).toHaveLength(1);
    expect(day.blocks[0]?.detail).toContain("Mathematics");
  });
});

describe("markerPercent", () => {
  const slots = [
    makeSlot({ id: "a", period_id: "p1", start_time: "09:00:00", end_time: "10:00:00" }),
    makeSlot({ id: "b", period_id: "p2", start_time: "10:00:00", end_time: "11:00:00" }),
  ];

  it("places now proportionally between the first bell and the last", () => {
    expect(markerPercent(toSchoolDay(slots, [], new Date(2026, 8, 9, 10, 0)))).toBe(50);
    expect(markerPercent(toSchoolDay(slots, [], new Date(2026, 8, 9, 9, 30)))).toBe(25);
  });

  it("clamps outside school hours rather than running the marker off the strip", () => {
    expect(markerPercent(toSchoolDay(slots, [], new Date(2026, 8, 9, 6, 0)))).toBe(0);
    expect(markerPercent(toSchoolDay(slots, [], new Date(2026, 8, 9, 21, 0)))).toBe(100);
  });

  it("answers 0 for a day with no measurable span rather than dividing by zero", () => {
    expect(markerPercent(toSchoolDay([], [], WEDNESDAY_MID_MORNING))).toBe(0);
  });
});
