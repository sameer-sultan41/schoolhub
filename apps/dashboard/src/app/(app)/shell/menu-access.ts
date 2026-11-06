import type { MenuConfig } from "@schoolhub/ui";
import type { AuthenticatedUser, PermissionKey } from "@schoolhub/types";

import { canAccessModule, hasAnyPermission } from "@/lib/permissions";

/**
 * `menu` narrowed to what `user` may see, at every level: an item with a `module` needs
 * `canAccessModule`, one with a `permission` needs that key (or one of a list of keys),
 * and a parent whose children all drop out goes with them. Items with neither key render as before. UX only;
 * the API enforces.
 */
export function filterMenuByAccess(
  menu: MenuConfig,
  user: AuthenticatedUser | undefined,
): MenuConfig {
  return menu.flatMap((item): MenuConfig => {
    if (item.module && !canAccessModule(user, item.module)) return [];
    if (item.permission) {
      const keys = (
        typeof item.permission === "string" ? [item.permission] : item.permission
      ) as readonly PermissionKey[];
      if (!hasAnyPermission(user, keys)) return [];
    }
    if (!item.children || item.children.length === 0) return [item];
    const children = filterMenuByAccess(item.children, user);
    return children.length > 0 ? [{ ...item, children }] : [];
  });
}

/** Every `path` in the menu, children included. */
export function collectMenuPaths(items: MenuConfig): string[] {
  return items.flatMap((item) => [
    ...(item.path ? [item.path] : []),
    ...(item.children ? collectMenuPaths(item.children) : []),
  ]);
}

/**
 * Whether a menu item at `path` is the active one for `pathname`: the path or a prefix of it, and
 * no other menu path matches more specifically. Without the second rule an item nested under
 * another's path (Exams at `/exams`, Grading scales at `/exams/grading-scales`) lights both up.
 */
export function isActiveMenuPath(
  path: string,
  pathname: string,
  menuPaths: readonly string[],
): boolean {
  const matches = (candidate: string) =>
    candidate === pathname || (candidate.length > 1 && pathname.startsWith(candidate));
  return matches(path) && !menuPaths.some((other) => other.length > path.length && matches(other));
}
