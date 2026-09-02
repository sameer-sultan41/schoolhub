import { formatCount, formatMinorUnits, formatPercent } from "./format";

describe("formatMinorUnits", () => {
  it("converts minor units to major units under the given currency", () => {
    // PKR's CLDR data formats with 0 fraction digits by default (ICU-version-dependent,
    // but stable across the Node versions this project targets) — USD below covers the
    // 2-decimal case.
    expect(formatMinorUnits(150000, "PKR", "en")).toBe("PKR 1,500");
  });

  it("handles zero and negative amounts", () => {
    expect(formatMinorUnits(0, "USD", "en")).toBe("$0.00");
    expect(formatMinorUnits(-500, "USD", "en")).toBe("-$5.00");
  });
});

describe("formatCount", () => {
  it("applies locale digit grouping", () => {
    expect(formatCount(1234, "en")).toBe("1,234");
  });

  it("formats small numbers without grouping", () => {
    expect(formatCount(7, "en")).toBe("7");
  });
});

describe("formatPercent", () => {
  it("formats a 0-100 ratio as a percentage", () => {
    expect(formatPercent(87.5, "en")).toBe("87.5%");
  });

  it("rounds to at most one fraction digit", () => {
    expect(formatPercent(33.333, "en")).toBe("33.3%");
  });

  it("formats 100 as a whole percentage", () => {
    expect(formatPercent(100, "en")).toBe("100%");
  });
});
