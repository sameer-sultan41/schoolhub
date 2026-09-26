import type { AuthenticatedUser } from "@schoolhub/types";

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
