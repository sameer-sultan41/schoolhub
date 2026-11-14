import { humanizeSnakeCase } from "@/lib/helpers";
import type { ErrorCodeTranslator } from "@/lib/error-message";

/**
 * An enum value's label through its exhaustive key map (L32). A value the server sends before
 * the map or the messages know it is shown humanised ("on_leave" -> "On leave"), never as a raw
 * message key; the `t.has` check follows `confirm-step.tsx`'s `channelLabel`.
 */
export function enumLabel<T extends string>(
  t: ErrorCodeTranslator,
  keys: Readonly<Record<T, string>>,
  value: T,
): string {
  const key = value in keys ? keys[value] : undefined;
  return key !== undefined && t.has(key) ? t(key) : humanizeSnakeCase(value);
}

/** An enum value's badge variant, or `fallback` for a value the map does not know yet. */
export function enumBadge<T extends string, V extends string>(
  variants: Readonly<Record<T, V>>,
  value: T,
  fallback: V,
): V {
  return value in variants ? variants[value] : fallback;
}
