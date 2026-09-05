import { mapPeriodFieldErrors } from "@/features/timetable/period-map-field-errors";

describe("mapPeriodFieldErrors", () => {
  it("routes the overlap message to the start-time input, where the user must act", () => {
    const { known, unknown } = mapPeriodFieldErrors({
      start_time: "This overlaps 'Recess' (10:30:00-10:50:00).",
    });
    expect(known.start_time).toBe("This overlaps 'Recess' (10:30:00-10:50:00).");
    expect(unknown).toEqual([]);
  });

  it("routes a non-field message to root", () => {
    expect(mapPeriodFieldErrors({ non_field: "Sequence already used." })).toEqual({
      known: {},
      unknown: ["Sequence already used."],
    });
  });

  it("returns empty buckets for an empty response", () => {
    expect(mapPeriodFieldErrors({})).toEqual({ known: {}, unknown: [] });
  });
});
