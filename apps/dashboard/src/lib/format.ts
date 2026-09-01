/** Formats an amount stored in minor currency units (e.g. cents) as a localized display
 * string, e.g. `formatMinorUnits(150000, "PKR", "en")` -> "PKR 1,500.00". */
export function formatMinorUnits(amount: number, currency: string, locale: string): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(amount / 100);
}
