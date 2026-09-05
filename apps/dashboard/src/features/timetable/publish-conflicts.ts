import { ApiError } from "@schoolhub/api-client";
import type { ConflictSeverity, TimetableConflict } from "@/features/timetable/timetable-types";

/**
 * Read the conflict list off a failed `:publish`.
 *
 * §16 says publish answers 422 "on hard conflicts", and the whole point of
 * returning the list is that the user can see which cells to fix — so swallowing
 * the 422 into "that action isn't allowed" is exactly what this screen must not
 * do.
 *
 * The findings arrive in `error.meta.conflicts`, not `error.details`, and the
 * distinction is load-bearing. `details` is a flat `[{field, issue}]` list, and
 * `core/api/exceptions._flatten_details` walks any nested structure into it one
 * leaf at a time; a conflict sent that way became `conflicts[0].slot_ids`
 * repeated once per id, of which `ApiError.fieldErrors()` keeps only the first.
 * The grid would have highlighted one side of a double booking and not the
 * other. `meta` exists so structured context passes through untouched.
 *
 * Everything below is defensive because `meta` is deliberately untyped at the
 * envelope — its shape is this endpoint's, so validating it is this module's
 * job. A finding missing its type or message is dropped rather than rendered
 * half-blank.
 */
export function conflictsFromError(error: unknown): TimetableConflict[] {
  if (!(error instanceof ApiError)) return [];

  const raw = error.meta.conflicts;
  if (!Array.isArray(raw)) return [];

  return raw.filter(isRecord).map(toConflict).filter(isConflict);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toConflict(row: Record<string, unknown>): Partial<TimetableConflict> {
  return {
    type: typeof row.type === "string" ? row.type : undefined,
    // Anything that is not one of the two documented severities is treated as
    // blocking: a finding we cannot classify is not one to quietly downgrade to
    // a warning.
    severity: (row.severity === "soft" ? "soft" : "hard") satisfies ConflictSeverity,
    slot_ids: Array.isArray(row.slot_ids)
      ? row.slot_ids.filter((id): id is string => typeof id === "string")
      : [],
    message: typeof row.message === "string" ? row.message : undefined,
  };
}

function isConflict(row: Partial<TimetableConflict>): row is TimetableConflict {
  return typeof row.type === "string" && typeof row.message === "string";
}
