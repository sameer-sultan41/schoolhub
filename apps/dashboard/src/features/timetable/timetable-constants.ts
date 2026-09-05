import type {
  ConflictSeverity,
  RoomTypeValue,
  SubstitutionStatusValue,
} from "@/features/timetable/timetable-types";

/** Page size sent to every timetable list — mirrors the API's own cursor default
 * (core.api.pagination.CursorPagination), kept explicit so the row count is a
 * deliberate choice. Same reasoning as academics-constants.ts. */
export const TIMETABLE_PAGE_SIZE = 25;

/**
 * Sentinel for "no filter" in a Select — kept out of the request params entirely
 * rather than sent as an empty string, so `{}` and `{status: ""}` are the same
 * cache key. Mirrors academics-constants.ts's ALL exactly.
 */
export const ALL = "__all__";

/** Sentinel for "leave this optional foreign key empty" inside a form Select.
 * Distinct from ALL because one means "do not filter" and the other means "write
 * NULL" — a slot with no room is a real, saved state (`room_id` is nullable),
 * while a filter of ALL is the absence of a choice. */
export const NONE = "__none__";

/**
 * `day_of_week` is 0-6 and models.py notes the week's start comes from tenant
 * configuration; services._slot_weekday says the same and adds that today every
 * seeded tenant is Monday-based. So the grid renders 0-6 in order and labels them
 * Monday-first — when the tenant week-start setting lands, only this array moves.
 */
export const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const;

/** The five columns a school week normally shows. The grid still renders a
 * weekend column when a slot exists there, so a Saturday school is not silently
 * truncated — this only decides what is shown when nothing is scheduled. */
export const DEFAULT_VISIBLE_WEEKDAYS = [0, 1, 2, 3, 4] as const;

export const ROOM_TYPES: RoomTypeValue[] = [
  "classroom",
  "lab",
  "library",
  "auditorium",
  "sports",
  "office",
  "other",
];

export const SUBSTITUTION_STATUSES: SubstitutionStatusValue[] = [
  "proposed",
  "confirmed",
  "declined",
  "completed",
  "cancelled",
];

/** Badge colour per substitution state (§7.2). Token utilities only — the
 * variants map to `--sh-*` custom properties, never to a literal colour. */
export const SUBSTITUTION_STATUS_BADGE: Record<
  SubstitutionStatusValue,
  "secondary" | "success" | "warning" | "danger"
> = {
  proposed: "warning",
  confirmed: "success",
  declined: "danger",
  completed: "success",
  cancelled: "secondary",
};

/** `hard` reads as an error because it blocks publish; `soft` as a warning
 * because a grid mid-build is allowed to be imperfect (conflicts.py's header). */
export const CONFLICT_SEVERITY_VARIANT: Record<ConflictSeverity, "danger" | "warning"> = {
  hard: "danger",
  soft: "warning",
};

/**
 * The `day_of_week` value for an ISO date string, or null when the string is not
 * a date.
 *
 * Two conversions in one, both easy to get wrong:
 *
 * - `Date.prototype.getDay()` is Sunday-based (0 = Sunday) while the API's
 *   `day_of_week` follows Python's `date.weekday()`, which is Monday-based
 *   (services._slot_weekday is explicit about this) — hence the `+ 6) % 7`.
 * - `getUTCDay`, not `getDay`: `new Date("2026-09-07")` is parsed as UTC
 *   midnight, so reading it in a timezone behind UTC gives the *previous* day.
 *   A date-only string has no timezone and must be read in the one it was
 *   written in.
 */
export function weekdayFromIsoDate(isoDate: string): number | null {
  if (!isoDate) return null;
  const parsed = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  return (parsed.getUTCDay() + 6) % 7;
}
