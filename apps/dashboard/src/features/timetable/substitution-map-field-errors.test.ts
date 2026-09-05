import { mapSubstitutionFieldErrors } from "@/features/timetable/substitution-map-field-errors";

describe("mapSubstitutionFieldErrors", () => {
  it("routes a rendered field to that field", () => {
    const { known } = mapSubstitutionFieldErrors({
      substitute_staff_id: "This teacher already has a class in that period.",
    });
    expect(known.substitute_staff_id).toBe("This teacher already has a class in that period.");
  });

  it("routes absent_staff_id to root — the form derives it and renders no input", () => {
    expect(
      mapSubstitutionFieldErrors({
        absent_staff_id: "This teacher is not the one scheduled for that slot.",
      }),
    ).toEqual({
      known: {},
      unknown: ["This teacher is not the one scheduled for that slot."],
    });
  });

  it("splits a mixed response", () => {
    const { known, unknown } = mapSubstitutionFieldErrors({
      date: "This date does not fall on the slot's weekday.",
      absent_staff_id: "Wrong teacher.",
    });
    expect(known).toEqual({ date: "This date does not fall on the slot's weekday." });
    expect(unknown).toEqual(["Wrong teacher."]);
  });

  it("returns empty buckets for an empty response", () => {
    expect(mapSubstitutionFieldErrors({})).toEqual({ known: {}, unknown: [] });
  });
});
