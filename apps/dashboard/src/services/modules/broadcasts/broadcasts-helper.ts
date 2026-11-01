/** The broadcasts module's pure helpers. */

/** Grouping separators a typed count may carry: `,`, the Arabic thousands separator and spaces. */
const GROUPING_SEPARATORS = /[,٬\s]/g;
/** Arabic-Indic (U+0660-U+0669) and Extended Arabic-Indic (U+06F0-U+06F9, Urdu's) digits. */
const ARABIC_INDIC_DIGITS = /[٠-٩۰-۹]/g;
const ARABIC_ZERO = 0x0660;
const EXTENDED_ZERO = 0x06f0;

/** An Arabic-Indic or Extended Arabic-Indic digit's value. */
function digitValue(digit: string): number {
  const code = digit.charCodeAt(0);
  return code - (code >= EXTENDED_ZERO ? EXTENDED_ZERO : ARABIC_ZERO);
}

/**
 * A typed recipient count in ASCII digits, so "15,000" and "۴۲" compare equal to 15000 and 42:
 * grouping separators dropped and Arabic-Indic digits mapped to `0`-`9`.
 */
export function normalizeTypedCount(typed: string): string {
  const ungrouped = typed.replace(GROUPING_SEPARATORS, "");
  return ungrouped.replace(ARABIC_INDIC_DIGITS, (digit) => String(digitValue(digit)));
}
