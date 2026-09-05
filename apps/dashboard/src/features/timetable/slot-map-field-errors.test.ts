import { mapSlotFieldErrors } from "@/features/timetable/slot-map-field-errors";

describe("mapSlotFieldErrors", () => {
  it("routes a field the dialog renders to that field", () => {
    expect(mapSlotFieldErrors({ staff_id: "Only teaching staff can be scheduled." })).toEqual({
      known: { staff_id: "Only teaching staff can be scheduled." },
      unknown: [],
    });
  });

  it("routes a cell coordinate to root — the dialog has no input for it", () => {
    expect(
      mapSlotFieldErrors({
        period_id: "This period is a break and cannot be scheduled.",
        non_field: "Something else.",
      }),
    ).toEqual({
      known: {},
      unknown: ["This period is a break and cannot be scheduled.", "Something else."],
    });
  });

  it("splits a mixed response", () => {
    const { known, unknown } = mapSlotFieldErrors({
      subject_id: "Unknown subject.",
      section_id: "Unknown section.",
    });
    expect(known).toEqual({ subject_id: "Unknown subject." });
    expect(unknown).toEqual(["Unknown section."]);
  });

  it("returns empty buckets for an empty response", () => {
    expect(mapSlotFieldErrors({})).toEqual({ known: {}, unknown: [] });
  });
});
