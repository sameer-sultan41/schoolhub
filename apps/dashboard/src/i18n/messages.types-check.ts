import type * as EnMessages from "../../messages/en.json";
import type * as UrMessages from "../../messages/ur.json";

/**
 * Compile-time-only: fails `tsc` if a locale file's shape diverges from en.json's.
 *
 * This file is never imported by anything — its only job is to sit inside the TS project
 * (`apps/dashboard/tsconfig.json` includes `**\/*.ts` regardless of import graph, and
 * ESLint's own glob matching is the same) so both tools walk it and catch a locale that
 * is missing a key en.json has, or has one with a mismatched type. `request.ts`'s own
 * `as` assertion only describes the value at that one call site — it cannot verify any
 * *other* locale file's real content, which is exactly what this file exists to do.
 *
 * `declare const` is safe here specifically because this file is dead code: nothing
 * bundles it, so the ambient (never-really-defined) value it names is never evaluated.
 * The same construct inside an actually-executed file would throw a real
 * `ReferenceError` the moment that line ran — do not copy this pattern into request.ts.
 */
type Messages = typeof EnMessages;
declare const urMessagesSample: typeof UrMessages;
const _urMessagesMatchEn: Messages = urMessagesSample;
void _urMessagesMatchEn;
