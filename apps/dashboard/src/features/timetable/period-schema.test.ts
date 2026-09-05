import { PERIOD_NAME_MAX_LENGTH, periodSchema } from "@/features/timetable/period-schema";

const VALID = {
  campus_id: "__none__",
  name: "Period 1",
  sequence: "1",
  start_time: "08:00",
  end_time: "08:40",
  is_break: false,
  weekdays: [],
};

describe("periodSchema", () => {
  it("accepts a well-formed period", () => {
    expect(periodSchema.safeParse(VALID).success).toBe(true);
  });

  it("requires a name", () => {
    expect(periodSchema.safeParse({ ...VALID, name: "" }).success).toBe(false);
  });

  it("rejects a name longer than the column", () => {
    expect(
      periodSchema.safeParse({ ...VALID, name: "x".repeat(PERIOD_NAME_MAX_LENGTH + 1) }).success,
    ).toBe(false);
  });

  it("requires a 1-based whole-number daily order", () => {
    expect(periodSchema.safeParse({ ...VALID, sequence: "0" }).success).toBe(false);
    expect(periodSchema.safeParse({ ...VALID, sequence: "1.5" }).success).toBe(false);
    expect(periodSchema.safeParse({ ...VALID, sequence: "" }).success).toBe(false);
  });

  it("mirrors the periods_end_after_start check constraint", () => {
    const result = periodSchema.safeParse({ ...VALID, start_time: "09:00", end_time: "08:00" });
    expect(result.success).toBe(false);
    expect(result.success ? [] : result.error.issues.map((issue) => issue.path[0])).toContain(
      "end_time",
    );
  });

  it("rejects equal start and end times", () => {
    expect(
      periodSchema.safeParse({ ...VALID, start_time: "08:00", end_time: "08:00" }).success,
    ).toBe(false);
  });

  it("accepts the HH:MM:SS a TimeField serialises to", () => {
    expect(
      periodSchema.safeParse({ ...VALID, start_time: "08:00:00", end_time: "08:40:00" }).success,
    ).toBe(true);
  });

  it("requires both times", () => {
    expect(periodSchema.safeParse({ ...VALID, start_time: "" }).success).toBe(false);
  });
});
