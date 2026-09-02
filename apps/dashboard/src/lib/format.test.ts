import { formatCount, formatDate, formatMinorUnits, formatPercent } from "@/lib/format";

describe("formatMinorUnits", () => {
  it("formats minor units as a localized currency string", () => {
    expect(formatMinorUnits(150000, "PKR", "en")).toContain("1,500");
  });
});

describe("formatCount", () => {
  it("formats a count with locale digit grouping", () => {
    expect(formatCount(1234, "en")).toBe("1,234");
  });
});

describe("formatPercent", () => {
  it("formats a 0-100 ratio as a percentage", () => {
    expect(formatPercent(87.5, "en")).toContain("87.5");
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
