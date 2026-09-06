/** Formats an amount stored in minor currency units (e.g. cents) as a localized display
 * string, e.g. `formatMinorUnits(150000, "PKR", "en")` -> "PKR 1,500.00". */
export function formatMinorUnits(amount: number, currency: string, locale: string): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(amount / 100);
}

/** Formats a plain count with locale-appropriate digit grouping, e.g. `formatCount(1234,
 * "en")` -> "1,234". Use anywhere a bare `String(n)` would otherwise sit next to a
 * locale-formatted figure (currency, percent) and look inconsistent under a non-Latin
 * locale's digit shaping. */
export function formatCount(value: number, locale: string): string {
  return new Intl.NumberFormat(locale).format(value);
}

/** Formats a ratio already expressed 0-100 as a localized percentage, e.g.
 * `formatPercent(87.5, "en")` -> "87.5%". */
export function formatPercent(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 1 }).format(
    value / 100,
  );
}

/** Formats an ISO date string (`"2026-04-01"`) as a localized display date. Returns the
 * raw string unchanged if it isn't parseable, rather than throwing or showing "Invalid
 * Date" — a malformed value from the server is a bug elsewhere, not a reason to crash
 * a detail screen. */
export function formatDate(isoDate: string, locale: string): string {
  const parsed = new Date(isoDate);
  if (Number.isNaN(parsed.getTime())) return isoDate;
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(parsed);
}

/**
 * Formats a wire time (`"08:00:00"`) for display, e.g. `formatTime("08:00:00", "en")` ->
 * "08:00".
 *
 * DRF serialises a `TimeField` with seconds. A bell schedule never has any, so rendering
 * them puts four characters of noise in every row of the periods table and pushes the
 * numbers that differ further apart. Returns the raw string unchanged if it is not a
 * parseable time, for the same reason `formatDate` does.
 */
export function formatTime(wireTime: string, locale: string): string {
  const match = /^(\d{2}):(\d{2})(?::\d{2})?$/.exec(wireTime.trim());
  if (!match) return wireTime;
  // A time alone has no date to attach it to; any date works because only the clock
  // fields are read back out. UTC so the local zone cannot shift the hour.
  const parsed = new Date(Date.UTC(2000, 0, 1, Number(match[1]), Number(match[2])));
  return new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    // h23, not the locale's own preference. Without it `en` renders "08:00 AM", which
    // is four characters of noise in place of the four this function exists to remove,
    // and the periods column is set in tabular figures precisely so a bell schedule
    // lines up down the page — an AM/PM suffix of varying width defeats that.
    hourCycle: "h23",
    timeZone: "UTC",
  }).format(parsed);
}

/**
 * Formats an ISO timestamp as a localized date and time, e.g. "1 Apr 2026, 14:30".
 *
 * For a moment the reader needs to place exactly — an audit entry, a batch that started.
 * Where "how long ago" is the more useful reading, pair `formatRelativeTime` in the cell
 * with this in a tooltip.
 */
export function formatDateTime(isoTimestamp: string, locale: string): string {
  const parsed = new Date(isoTimestamp);
  if (Number.isNaN(parsed.getTime())) return isoTimestamp;
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(
    parsed,
  );
}

/**
 * Formats an ISO timestamp as time elapsed, e.g. "3 days ago".
 *
 * Coarsest unit that still says something true: a batch started "2 months ago" is more
 * use at a glance than its date, and the date stays available in a tooltip beside it.
 *
 * `now` is a parameter rather than a `Date.now()` call so a test can pin it — the same
 * reason `test-utils.tsx` fixes next-intl's clock.
 */
export function formatRelativeTime(isoTimestamp: string, locale: string, now = new Date()): string {
  const parsed = new Date(isoTimestamp);
  if (Number.isNaN(parsed.getTime())) return isoTimestamp;

  const seconds = Math.round((parsed.getTime() - now.getTime()) / 1000);
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 60 * 60 * 24 * 365],
    ["month", 60 * 60 * 24 * 30],
    ["day", 60 * 60 * 24],
    ["hour", 60 * 60],
    ["minute", 60],
  ];

  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  for (const [unit, secondsPerUnit] of units) {
    if (Math.abs(seconds) >= secondsPerUnit) {
      return formatter.format(Math.round(seconds / secondsPerUnit), unit);
    }
  }
  // Under a minute. "now" reads better than "in 0 seconds", which is what the formatter
  // would produce for a timestamp a few hundred milliseconds old.
  return formatter.format(0, "second");
}
