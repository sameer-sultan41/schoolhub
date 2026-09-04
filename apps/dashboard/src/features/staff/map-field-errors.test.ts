import { mapFieldErrors } from "@/features/staff/map-field-errors";

describe("mapFieldErrors", () => {
  it("routes a known field to the known bucket", () => {
    const { known, unknown } = mapFieldErrors({ first_name: "Required." });
    expect(known.first_name).toBe("Required.");
    expect(unknown).toEqual([]);
  });

  it("routes an unrecognised field's message to the unknown bucket", () => {
    const { known, unknown } = mapFieldErrors({
      photo_file_id: "This file has not been confirmed yet.",
    });
    expect(known).toEqual({});
    expect(unknown).toEqual(["This file has not been confirmed yet."]);
  });

  it("handles a mix of known and unknown fields", () => {
    const { known, unknown } = mapFieldErrors({
      last_name: "Required.",
      non_field: "Something else is wrong.",
    });
    expect(known.last_name).toBe("Required.");
    expect(unknown).toEqual(["Something else is wrong."]);
  });

  it("returns empty buckets for an empty input", () => {
    const { known, unknown } = mapFieldErrors({});
    expect(known).toEqual({});
    expect(unknown).toEqual([]);
  });
});
