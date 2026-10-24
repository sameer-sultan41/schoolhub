import {
  downloadFile,
  formatDate,
  isIsoDate,
  isUuid,
  stableSignedUrl,
  todayIsoDate,
  toOrdering,
} from "../helpers";

/** A SigV4-shaped link for `path`, signed at `signedAt` (UTC) and valid for `ttlSeconds`. */
function signedLink(path: string, signedAt: string, ttlSeconds = 3600) {
  return (
    `http://localhost:9000/schoolhub-dev/${path}?X-Amz-Algorithm=AWS4-HMAC-SHA256` +
    `&X-Amz-Date=${signedAt}&X-Amz-Expires=${String(ttlSeconds)}&X-Amz-Signature=${signedAt}`
  );
}

const T0 = Date.UTC(2026, 8, 24, 18, 0, 0); // 20260924T180000Z

// Each test uses its own object path: the helper remembers links for the whole session.
describe("stableSignedUrl", () => {
  it("keeps the link already in use for the same photo while it has time left", () => {
    const first = signedLink("a.png", "20260924T180000Z");
    const refetched = signedLink("a.png", "20260924T181000Z");

    expect(stableSignedUrl(first, T0)).toBe(first);
    expect(stableSignedUrl(refetched, T0 + 10 * 60_000)).toBe(first);
  });

  it("adopts the fresh link once the one in use is about to expire", () => {
    const first = signedLink("b.png", "20260924T180000Z");
    const refetched = signedLink("b.png", "20260924T185700Z");

    stableSignedUrl(first, T0);

    // 57 minutes in: the first link has 3 minutes left, under the 5-minute margin.
    expect(stableSignedUrl(refetched, T0 + 57 * 60_000)).toBe(refetched);
  });

  it("never swaps one photo's link for another's", () => {
    const one = signedLink("c.png", "20260924T180000Z");
    const other = signedLink("d.png", "20260924T180000Z");

    stableSignedUrl(one, T0);

    expect(stableSignedUrl(other, T0)).toBe(other);
  });

  it("passes through a string that isn't a URL at all, rather than throwing", () => {
    expect(stableSignedUrl("not a url", T0)).toBe("not a url");
  });

  it("passes through links it cannot date, and null", () => {
    const first = "https://null-presigner.invalid/tenants/t/e.png";
    const second = "https://null-presigner.invalid/tenants/t/e.png?v=2";

    stableSignedUrl(first, T0);

    expect(stableSignedUrl(second, T0)).toBe(second);
    expect(stableSignedUrl(null, T0)).toBeNull();
  });
});

describe("downloadFile", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("clicks a transient anchor pointing at the URL, with the filename hint", () => {
    const click = jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    downloadFile("https://storage.test/o/1", "students-export.csv");

    // Jest records the receiver (`this`) in `mock.contexts`, not `mock.instances`.
    const anchor = click.mock.contexts[0] as HTMLAnchorElement;
    expect(anchor.href).toBe("https://storage.test/o/1");
    expect(anchor.download).toBe("students-export.csv");
  });

  it("leaves the filename hint off when none is given", () => {
    const click = jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    downloadFile("https://storage.test/o/2");

    const anchor = click.mock.contexts[0] as HTMLAnchorElement;
    expect(anchor.href).toBe("https://storage.test/o/2");
    expect(anchor.hasAttribute("download")).toBe(false);
  });
});

describe("formatDate", () => {
  it("returns the raw value unchanged for an invalid date string", () => {
    expect(formatDate("not-a-date")).toBe("not-a-date");
  });

  it("formats a valid date as a long absolute date", () => {
    // date-fns "PPP" format for 2026-01-05 — matches staff-detail-sheet.test.tsx's own
    // precedent for this same format string.
    expect(formatDate("2026-01-05")).toBe("January 5th, 2026");
  });

  it("falls back to English for a locale date-fns ships no translation for", () => {
    // date-fns has no "ur" locale at all — resolveDateFnsLocale must fall back to enUS
    // rather than throwing or silently passing an undefined locale to format().
    expect(formatDate("2026-01-05", "ur")).toBe("January 5th, 2026");
  });

  describe("in a negative-UTC-offset timezone", () => {
    // Regression: `new Date("2026-01-05")` is parsed as UTC midnight (ECMA-262's Date
    // Time String Format for a date-only string), then `format()` rendered that instant
    // in the BROWSER's LOCAL zone — one calendar day early for any viewer west of UTC.
    // The whole dashboard test suite runs under America/New_York (UTC-5 in January, no
    // DST) via `jest.global-setup.ts`, which reproduces this deterministically — setting
    // `process.env.TZ` here instead would not work, since a running test's `process.env`
    // is a Jest-sandboxed Proxy over a snapshot copy, never read by Node's real
    // Date/Intl timezone resolution.
    it("renders a date-only string as the same calendar date, not one day earlier", () => {
      expect(formatDate("2026-01-05")).toBe("January 5th, 2026");
    });
  });
});

describe("isIsoDate", () => {
  it("accepts a real calendar date, a leap day included", () => {
    expect(isIsoDate("2026-10-24")).toBe(true);
    expect(isIsoDate("2028-02-29")).toBe(true);
  });

  it("rejects a date that is not on the calendar", () => {
    expect(isIsoDate("2026-13-45")).toBe(false);
    expect(isIsoDate("2026-02-30")).toBe(false);
    expect(isIsoDate("2027-02-29")).toBe(false);
    expect(isIsoDate("2026-00-10")).toBe(false);
  });

  it("rejects text that is not YYYY-MM-DD", () => {
    expect(isIsoDate("")).toBe(false);
    expect(isIsoDate("2026-1-5")).toBe(false);
    expect(isIsoDate("24/10/2026")).toBe(false);
  });
});

describe("isUuid", () => {
  it("accepts a canonical UUID in either case", () => {
    expect(isUuid("6f1d2c3b-4a5e-4f60-8a71-92b3c4d5e6f7")).toBe(true);
    expect(isUuid("6F1D2C3B-4A5E-4F60-8A71-92B3C4D5E6F7")).toBe(true);
  });

  it.each([
    "",
    "xyz",
    "campus-0001",
    "6f1d2c3b4a5e4f608a7192b3c4d5e6f7",
    "6f1d2c3b-4a5e-4f60-8a71-92b3c4d5e6f7x",
  ])("rejects %p", (value) => {
    expect(isUuid(value)).toBe(false);
  });
});

describe("toOrdering", () => {
  const FIELDS = { name: "last_name", joiningDate: "joining_date" };

  it("maps the sorted column to its API field, ascending", () => {
    expect(toOrdering([{ id: "name", desc: false }], FIELDS)).toBe("last_name");
  });

  it("prefixes a descending sort with a minus", () => {
    expect(toOrdering([{ id: "joiningDate", desc: true }], FIELDS)).toBe("-joining_date");
  });

  it("is undefined with no sort, so the param is omitted", () => {
    expect(toOrdering([], FIELDS)).toBeUndefined();
  });

  // Not the literal text "undefined" spliced into the query string.
  it("is undefined for a column the map has no field for", () => {
    expect(toOrdering([{ id: "updatedAt", desc: true }], FIELDS)).toBeUndefined();
  });

  it("reads only the first sort", () => {
    const sorting = [
      { id: "name", desc: true },
      { id: "joiningDate", desc: false },
    ];

    expect(toOrdering(sorting, FIELDS)).toBe("-last_name");
  });
});

describe("todayIsoDate", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  // The server's "today" is the UTC date. The suite runs under America/New_York
  // (`jest.global-setup.ts`), where 02:30Z is still the evening of the day before.
  it("is the UTC date, not the viewer's local one", () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-01-06T02:30:00Z"));

    expect(new Date().getDate()).toBe(5);
    expect(todayIsoDate()).toBe("2026-01-06");
  });

  it("is a zero-padded YYYY-MM-DD date", () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-03-04T23:59:59Z"));

    expect(todayIsoDate()).toBe("2026-03-04");
  });
});
