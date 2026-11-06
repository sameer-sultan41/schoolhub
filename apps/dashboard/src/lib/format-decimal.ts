import { decimalFormat } from "@/lib/helpers";

/** A server decimal string ("96.00") shown in the viewer's locale, with `fractionDigits`
 * at most. Display only: every total and percentage is computed by the server. */
export function formatDecimal(locale: string, value: string, fractionDigits = 2): string {
  const parsed = Number(value);
  return Number.isNaN(parsed) ? value : decimalFormat(locale, fractionDigits).format(parsed);
}
