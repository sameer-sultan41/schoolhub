import type { AuthenticatedUser, PermissionKey } from "@schoolhub/types";

/**
 * Permission-aware UI helpers.
 *
 * **This is UX, not security.** Hiding a button prevents a confusing dead end; the API
 * enforces every permission server-side and returns 403 (or 404 for cross-tenant reads)
 * regardless of what the UI shows. Never use these helpers to guard data you already hold.
 *
 * Keys are `module.resource.action` strings (auth-and-rbac.md §2.1), e.g.
 * `hasPermission(user, "fees.invoice.create")`.
 */

type MaybeUser = Pick<AuthenticatedUser, "permissions"> | null | undefined;

export function hasPermission(user: MaybeUser, permission: PermissionKey): boolean {
  if (!user) return false;
  return user.permissions.includes(permission);
}

/** True when the user holds every listed permission (an AND gate). */
export function hasAllPermissions(user: MaybeUser, permissions: PermissionKey[]): boolean {
  if (!user) return false;
  return permissions.every((permission) => user.permissions.includes(permission));
}

/** True when the user holds at least one of the listed permissions (an OR gate). */
export function hasAnyPermission(user: MaybeUser, permissions: PermissionKey[]): boolean {
  if (!user) return false;
  return permissions.some((permission) => user.permissions.includes(permission));
}

/**
 * True when the user can do anything at all in a module — used to decide whether a
 * navigation entry appears. Module enablement (plan/feature flag) is checked separately.
 */
export function canAccessModule(user: MaybeUser, module: string): boolean {
  if (!user) return false;
  const prefix = `${module}.`;
  return user.permissions.some((permission) => permission.startsWith(prefix));
}

export function hasRole(
  user: Pick<AuthenticatedUser, "roles"> | null | undefined,
  slug: string,
): boolean {
  if (!user) return false;
  return user.roles.some((role) => role.slug === slug);
}

/** Split a permission key into its parts. Returns null for a malformed key. */
export function parsePermission(
  permission: string,
): { module: string; resource: string; action: string } | null {
  const parts = permission.split(".");
  if (parts.length !== 3) return null;
  const [module, resource, action] = parts;
  if (!module || !resource || !action) return null;
  return { module, resource, action };
}
