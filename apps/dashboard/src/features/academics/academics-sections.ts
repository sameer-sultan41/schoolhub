import type { AuthenticatedUser, PermissionKey } from "@schoolhub/types";

import { Paths } from "@/config/paths";
import { hasPermission } from "@/lib/permissions";

export interface AcademicsSection {
  href: string;
  /** Tab label, under the `academics` message namespace. */
  labelKey: string;
  /** The sidebar child's title (the sidebar is not translated yet). */
  menuTitle: string;
  /** The `.view` key that shows this section. */
  permission: PermissionKey;
}

/**
 * The one list of Academics sections, in tab order. The nav tabs, the `/academics` landing
 * and the sidebar's children all derive from it, so a section can't be gated in one place
 * and not another.
 */
export const ACADEMICS_SECTIONS = [
  {
    href: Paths.ACADEMICS_CURRICULUM,
    labelKey: "nav.curriculum",
    menuTitle: "Curriculum",
    permission: "academics.curriculum.view",
  },
] as const satisfies readonly AcademicsSection[];

/** The sections `user` may open, in tab order — empty while the user is still loading. */
export function permittedAcademicsSections(
  user: AuthenticatedUser | undefined,
): readonly AcademicsSection[] {
  return ACADEMICS_SECTIONS.filter((section) => hasPermission(user, section.permission));
}
