import { formatDecimal, formatMoney } from "../format-decimal";

describe("formatDecimal", () => {
  it("groups thousands in the locale and drops trailing zeros", () => {
    expect(formatDecimal("en", "12500.00")).toBe("12,500");
    expect(formatDecimal("en", "12500.50")).toBe("12,500.5");
  });

  it("honours the fraction digits cap", () => {
    expect(formatDecimal("en", "96.456", 1)).toBe("96.5");
    expect(formatDecimal("en", "96.456")).toBe("96.46");
  });

  it("returns a non-numeric value unchanged", () => {
    expect(formatDecimal("en", "n/a")).toBe("n/a");
  });
});

describe("formatMoney", () => {
  it("always shows two decimals, grouped in the locale", () => {
    expect(formatMoney("en", "1500")).toBe("1,500.00");
    expect(formatMoney("en", "1500.5")).toBe("1,500.50");
  });

  it("returns a non-numeric value unchanged", () => {
    expect(formatMoney("en", "n/a")).toBe("n/a");
  });
});
