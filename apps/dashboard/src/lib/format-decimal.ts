import { decimalFormat } from "@/lib/helpers";

/** A server decimal string ("96.00") shown in the viewer's locale, with `fractionDigits`
 * at most. Display only: every total and percentage is computed by the server. */
export function formatDecimal(locale: string, value: string, fractionDigits = 2): string {
  const parsed = Number(value);
  return Number.isNaN(parsed) ? value : decimalFormat(locale, fractionDigits).format(parsed);
}

/** A server money string ("1500", "1500.5") shown in the viewer's locale with exactly two
 * decimals ("1,500.00", "1,500.50"), no currency symbol. A non-numeric value is returned as
 * it came. Display only. */
export function formatMoney(locale: string, value: string): string {
  const parsed = Number(value);
  return Number.isNaN(parsed) ? value : decimalFormat(locale, 2, { fixed: true }).format(parsed);
}
