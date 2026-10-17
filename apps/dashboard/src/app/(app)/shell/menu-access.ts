import type { MenuConfig } from "@schoolhub/ui";
import type { AuthenticatedUser, PermissionKey } from "@schoolhub/types";

import { canAccessModule, hasPermission } from "@/lib/permissions";

/**
 * `menu` narrowed to what `user` may see, at every level: an item with a `module` needs
 * `canAccessModule`, one with a `permission` needs `hasPermission`, and a parent whose
 * children all drop out goes with them. Items with neither key render as before. UX only;
 * the API enforces.
 */
export function filterMenuByAccess(
  menu: MenuConfig,
  user: AuthenticatedUser | undefined,
): MenuConfig {
  return menu.flatMap((item): MenuConfig => {
    if (item.module && !canAccessModule(user, item.module)) return [];
    if (item.permission && !hasPermission(user, item.permission as PermissionKey)) return [];
    if (!item.children || item.children.length === 0) return [item];
    const children = filterMenuByAccess(item.children, user);
    return children.length > 0 ? [{ ...item, children }] : [];
  });
}
