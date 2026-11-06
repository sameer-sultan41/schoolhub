import {
  buildBandInput,
  buildScaleInput,
  checkBandCoverage,
  defaultBandFormValues,
  nextSortOrder,
  recordToBandFormValues,
  recordToScaleFormValues,
  toScaleBody,
  toScaleQueryParams,
  typeFilterToScaleType,
} from "../grading-scales-helper";
import { bandRecord, scaleRecord } from "./grading-scales-fixtures";

function band(label: string, min: string, max: string) {
  return { label, min_percent: min, max_percent: max };
}

describe("checkBandCoverage", () => {
  it("passes bands that meet at the next hundredth and span 0 to 100", () => {
    expect(checkBandCoverage([band("B", "50.00", "100.00"), band("F", "0.00", "49.99")])).toEqual(
      [],
    );
  });

  it("flags a gap between two bands, naming both and the seam", () => {
    expect(checkBandCoverage([band("F", "0", "49"), band("P", "50", "100")])).toEqual([
      { kind: "gap", lower: "F", upper: "P", from: "49", to: "50" },
    ]);
  });

  it("flags an overlap, and a shared percentage counts as one", () => {
    expect(checkBandCoverage([band("F", "0", "50"), band("P", "50", "100")])).toEqual([
      { kind: "overlap", lower: "F", upper: "P", from: "50", to: "50" },
    ]);
    expect(checkBandCoverage([band("F", "0", "60"), band("P", "55", "100")])).toEqual([
      { kind: "overlap", lower: "F", upper: "P", from: "60", to: "55" },
    ]);
  });

  it("flags a scale that does not start at 0 or end at 100", () => {
    expect(checkBandCoverage([band("F", "10", "49.99"), band("P", "50", "90")])).toEqual([
      { kind: "start", at: "10" },
      { kind: "end", at: "90" },
    ]);
  });

  it("reads the bands sorted by lower bound, whatever order they arrive in", () => {
    expect(
      checkBandCoverage([
        band("A", "80", "100"),
        band("C", "0", "49.99"),
        band("B", "50", "79.99"),
      ]),
    ).toEqual([]);
  });

  it("says there are no bands for an empty scale", () => {
    expect(checkBandCoverage([])).toEqual([{ kind: "empty" }]);
  });
});

describe("grading-scales-helper", () => {
  it("round-trips a scale record through the form, leaving no maximum for a letter scale", () => {
    const values = recordToScaleFormValues(scaleRecord());

    expect(buildScaleInput(values)).toEqual({
      name: "Standard letters",
      scaleType: "letter",
      gpaMax: null,
      description: null,
    });
  });

  it("sends the maximum grade point for a GPA scale only", () => {
    const values = { name: "GPA", scale_type: "gpa" as const, gpa_max: " 4.00 ", description: "" };

    expect(buildScaleInput(values).gpaMax).toBe("4.00");
    expect(buildScaleInput({ ...values, scale_type: "percentage" }).gpaMax).toBeNull();
  });

  it("round-trips a band, sending blank optional fields as null and the order as a number", () => {
    const values = recordToBandFormValues(bandRecord({ sort_order: 3 }));

    expect(buildBandInput(values)).toEqual({
      label: "A",
      minPercent: "80.00",
      maxPercent: "100.00",
      gradePoint: null,
      isPassing: true,
      remark: null,
      sortOrder: 3,
    });
  });

  it("puts a new band after the last in the order", () => {
    expect(nextSortOrder([])).toBe(0);
    expect(nextSortOrder([{ sort_order: 0 }, { sort_order: 4 }])).toBe(5);
    expect(defaultBandFormValues(2).sort_order).toBe("2");
  });

  it("maps the query and body to the API's snake_case, dropping blanks", () => {
    expect(
      toScaleQueryParams({ page: 2, pageSize: 10, search: "", ordering: "name", scaleType: "gpa" }),
    ).toEqual({ page: 2, page_size: 10, ordering: "name", scale_type: "gpa" });
    expect(toScaleBody({ name: "X", scaleType: "hybrid", gpaMax: null })).toEqual({
      name: "X",
      scale_type: "hybrid",
      gpa_max: null,
    });
    expect(typeFilterToScaleType("all")).toBeUndefined();
    expect(typeFilterToScaleType("gpa")).toBe("gpa");
  });
});
