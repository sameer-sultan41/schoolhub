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
