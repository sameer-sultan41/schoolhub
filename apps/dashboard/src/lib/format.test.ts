import {
  formatCount,
  formatDate,
  formatDateTime,
  formatMinorUnits,
  formatPercent,
  formatRelativeTime,
  formatTime,
} from "@/lib/format";

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

describe("formatTime", () => {
  it("drops the seconds DRF serialises a TimeField with", () => {
    expect(formatTime("08:00:00", "en")).toBe("08:00");
    expect(formatTime("13:45:00", "en")).toBe("13:45");
  });

  it("accepts a time that already has no seconds", () => {
    expect(formatTime("08:00", "en")).toBe("08:00");
  });

  it("returns anything unparseable unchanged rather than inventing a time", () => {
    expect(formatTime("", "en")).toBe("");
    expect(formatTime("not a time", "en")).toBe("not a time");
    expect(formatTime("25:99:00", "en")).toBe("25:99:00");
  });

  it("reads the clock fields back out in UTC, so the local zone cannot shift the hour", () => {
    // Without the explicit timeZone this would render as 03:00 for a viewer in UTC-5.
    expect(formatTime("08:00:00", "en")).toBe("08:00");
  });
});

describe("formatDateTime", () => {
  it("renders a date and a time together", () => {
    const iso = "2026-04-01T14:30:00Z";
    const expected = new Intl.DateTimeFormat("en", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(iso));
    expect(formatDateTime(iso, "en")).toBe(expected);
  });

  it("returns an unparseable value unchanged rather than showing Invalid Date", () => {
    expect(formatDateTime("nonsense", "en")).toBe("nonsense");
  });
});

describe("formatRelativeTime", () => {
  const now = new Date("2026-04-01T12:00:00Z");

  it("picks the coarsest unit that still says something true", () => {
    expect(formatRelativeTime("2026-03-29T12:00:00Z", "en", now)).toBe("3 days ago");
    expect(formatRelativeTime("2026-04-01T09:00:00Z", "en", now)).toBe("3 hours ago");
    expect(formatRelativeTime("2026-01-01T12:00:00Z", "en", now)).toBe("3 months ago");
    expect(formatRelativeTime("2024-04-01T12:00:00Z", "en", now)).toBe("2 years ago");
  });

  it("says 'now' rather than 'in 0 seconds' for something that just happened", () => {
    expect(formatRelativeTime("2026-04-01T11:59:59Z", "en", now)).toBe("now");
  });

  it("handles a future timestamp", () => {
    expect(formatRelativeTime("2026-04-03T12:00:00Z", "en", now)).toBe("in 2 days");
  });

  it("returns an unparseable value unchanged", () => {
    expect(formatRelativeTime("nonsense", "en", now)).toBe("nonsense");
  });
});
