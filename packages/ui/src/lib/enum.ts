/**
 * Home for shared "enum-like" values: a fixed set of string literals used as a type in more
 * than one place. Empty today — a repo-wide sweep (2026-09-01) found no duplicated
 * string-literal union or repeated fixed-option set anywhere; every `cva` variant map and
 * prop union in `packages/ui/src/components/*` is defined once, co-located with its single
 * consumer, which is correct as-is and does not belong here.
 *
 * Add an entry here only once a set of literals is actually shared across more than one
 * file — moving a single-consumer union here pre-emptively would just relocate it without
 * removing any duplication. Use the const-object pattern below, not TypeScript's `enum`
 * keyword (org convention: enums carry runtime cost and quirks a plain object avoids):
 *
 *   export const Status = { Active: "active", Inactive: "inactive" } as const;
 *   export type Status = (typeof Status)[keyof typeof Status];
 */
export {};
