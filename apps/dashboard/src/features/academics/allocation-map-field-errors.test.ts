import { mapAllocationFieldErrors } from "@/features/academics/allocation-map-field-errors";

describe("mapAllocationFieldErrors", () => {
  it("routes a rendered field to the known bucket", () => {
    expect(mapAllocationFieldErrors({ staff_id: "Already allocated." })).toEqual({
      known: { staff_id: "Already allocated." },
      unknown: [],
    });
  });

  it("routes rules with no matching control to the unknown bucket", () => {
    const result = mapAllocationFieldErrors({
      non_field: "The subject is not in this class's curriculum.",
      effective_to: "Must not precede the start date.",
    });

    expect(result.known).toEqual({});
    expect(result.unknown).toEqual([
      "The subject is not in this class's curriculum.",
      "Must not precede the start date.",
    ]);
  });

  it("returns empty buckets for an empty envelope", () => {
    expect(mapAllocationFieldErrors({})).toEqual({ known: {}, unknown: [] });
  });
});
