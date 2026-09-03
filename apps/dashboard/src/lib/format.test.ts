import { formatCount, formatDate, formatMinorUnits, formatPercent } from "@/lib/format";

describe("formatMinorUnits", () => {
  it("converts minor units to major units under the given currency", () => {
    // Built via the same Intl call rather than a hand-typed literal: ICU inserts a
    // non-breaking space (U+00A0) between "PKR" and the amount, invisible in a diff but
    // not equal to a normal typed space, and PKR's CLDR data uses 0 fraction digits by
    // default (ICU-version-dependent, but stable across the Node versions this project
    // targets) — USD below covers the 2-decimal case with a symbol, not a code, so
    // neither quirk applies there.
    const expected = new Intl.NumberFormat("en", { style: "currency", currency: "PKR" }).format(
      1500,
    );
    expect(formatMinorUnits(150000, "PKR", "en")).toBe(expected);
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

describe("formatDate", () => {
  it("formats an ISO date string for the given locale", () => {
    const formatted = formatDate("2026-04-01", "en");
    expect(formatted).toContain("2026");
  });

  it("returns the raw string unchanged when it cannot be parsed", () => {
    expect(formatDate("not-a-date", "en")).toBe("not-a-date");
  });
});
