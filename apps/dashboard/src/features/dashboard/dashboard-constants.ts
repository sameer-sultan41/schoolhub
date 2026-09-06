import type { PermissionKey } from "@schoolhub/types";

/**
 * Shared numbers and keys for the home screen.
 *
 * The home screen reads six modules' worth of endpoints, so the values that decide
 * "how much of this fits on a dashboard" live in one place rather than being retyped
 * per panel.
 */

/**
 * How many rows a home-screen chart shows before the rest becomes a footer count.
 *
 * Eight is what fits above the fold on a laptop without the panel becoming the screen.
 * The remainder is always stated — a truncated chart that does not say it is truncated
 * is a chart that lies about the shape of the data.
 */
export const DASHBOARD_MAX_ROWS = 8;

/** How many pending items a queue panel previews before deferring to its full screen. */
export const PENDING_PREVIEW_SIZE = 5;

/**
 * Reference lists (classes, sections, subjects, rooms, houses, campuses, the session
 * list) change a few times a year. Both times are set together deliberately: a
 * staleTime above the 5-minute default must carry its own gcTime, or the entry can be
 * evicted before it goes stale — students/use-reference-data.ts explains the pairing.
 */
export const DASHBOARD_REFERENCE_STALE_TIME_MS = 10 * 60_000;
export const DASHBOARD_REFERENCE_GC_TIME_MS = 15 * 60_000;

/**
 * Role slugs the API treats as restricted principals — `DenyRestrictedPrincipals`
 * (apps/api/core/rbac/permissions.py) refuses every staff endpoint to a user holding
 * one, regardless of which permission keys the role carries.
 *
 * This matters for the bell-schedule band. `GET /periods` declares no view key of its
 * own — apps/timetable/views.py reads it under `timetable.timetable.view`, which a
 * student and a guardian both hold — but `PeriodViewSet` also stacks
 * `DenyRestrictedPrincipals`, so for those two the call is a 403 no matter what. The
 * band therefore asks for the bell schedule only when the viewer is not one of them,
 * and falls back to composing the day out of the timetable rows alone.
 */
export const RESTRICTED_ROLE_SLUGS: readonly string[] = ["student", "guardian"];

/** `timetable.timetable.view` — what `/timetables/my`, `/periods` and `/rooms` all read under. */
export const TIMETABLE_VIEW_PERMISSION: PermissionKey = "timetable.timetable.view";
