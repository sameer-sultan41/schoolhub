import { mapCurriculumFieldErrors } from "@/features/academics/curriculum-map-field-errors";

describe("mapCurriculumFieldErrors", () => {
  it("routes a rendered field to the known bucket", () => {
    expect(mapCurriculumFieldErrors({ weekly_periods: "Must be at least 1." })).toEqual({
      known: { weekly_periods: "Must be at least 1." },
      unknown: [],
    });
  });

  it("routes term_plans and non_field to the unknown bucket", () => {
    const result = mapCurriculumFieldErrors({
      term_plans: "These terms do not belong to this session.",
      non_field: "That session is closed.",
    });

    expect(result.known).toEqual({});
    expect(result.unknown).toEqual([
      "These terms do not belong to this session.",
      "That session is closed.",
    ]);
  });

  it("returns empty buckets for an empty envelope", () => {
    expect(mapCurriculumFieldErrors({})).toEqual({ known: {}, unknown: [] });
  });
});
