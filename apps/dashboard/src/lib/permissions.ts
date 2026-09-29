import type { AuthenticatedUser, PermissionKey } from "@schoolhub/types";

/**
 * True when the signed-in user holds any permission key under this module — e.g.
 * `canAccessModule(user, "staff")` is true for "staff.staff.view", "staff.staff.create", etc.
 * Used to show or hide a whole nav entry; the API remains the sole authority for every
 * actual request regardless of what the sidebar shows (see AGENTS.md's "Permission-aware
 * UI" rule).
 */
export function canAccessModule(user: AuthenticatedUser | undefined, module: string): boolean {
  return user?.permissions.some((key) => key.startsWith(`${module}.`)) ?? false;
}

/**
 * True when the signed-in user holds this exact permission key — the per-action
 * counterpart to `canAccessModule`'s whole-module check. `apps/dashboard/AGENTS.md`'s
 * wiring table names this as the thing to add "when the first screen needs
 * action-level gating": `staff.staff.export`/`.import` are granted to `STAFF_IO`
 * (`hr_staff`, `it_admin`), narrower than `RECORD_MANAGERS` (`hr_staff`,
 * `school_admin`) who already see every other action on this screen — rendering
 * these two buttons unconditionally would show a `school_admin` two buttons that
 * always 403.
 */
export function hasPermission(user: AuthenticatedUser | undefined, key: PermissionKey): boolean {
  return user?.permissions.includes(key) ?? false;
}
