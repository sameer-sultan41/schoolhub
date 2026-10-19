import type { MenuItem } from "@schoolhub/ui";
import type { AuthenticatedUser, PermissionKey } from "@schoolhub/types";

import { hasAnyPermission } from "@/lib/permissions";

/** One tab of a module with several screens (Academics, Timetable): its tab, its sidebar
 * child and its place in the landing redirect all come from this one entry. */
export interface ModuleSection {
  href: string;
  /** Tab label, under the module's own message namespace. */
  labelKey: string;
  /** The sidebar child's title (the sidebar is not translated yet). */
  menuTitle: string;
  /** The key that shows this section; a list means any one of them will do. */
  permission: PermissionKey | readonly PermissionKey[];
}

function sectionKeys(section: ModuleSection): readonly PermissionKey[] {
  return typeof section.permission === "string" ? [section.permission] : section.permission;
}

/** The sections `user` may open, in tab order — empty while the user is still loading. */
export function permittedSections<T extends ModuleSection>(
  sections: readonly T[],
  user: AuthenticatedUser | undefined,
): readonly T[] {
  return sections.filter((section) => hasAnyPermission(user, sectionKeys(section)));
}

/** The sidebar children for a module's sections, gated on the same keys as the tabs. */
export function sectionMenuItems(sections: readonly ModuleSection[]): MenuItem[] {
  return sections.map((section) => ({
    title: section.menuTitle,
    path: section.href,
    permission: section.permission,
  }));
}
