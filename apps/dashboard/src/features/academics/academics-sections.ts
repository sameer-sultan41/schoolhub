import type { ModuleSection } from "@/components/module-sections/module-sections";
import { Paths } from "@/config/paths";

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
  {
    href: Paths.ACADEMICS_ALLOCATIONS,
    labelKey: "nav.allocations",
    menuTitle: "Teacher allocation",
    permission: "academics.teacher-allocation.view",
  },
  {
    href: Paths.ACADEMICS_PROMOTIONS,
    labelKey: "nav.promotions",
    menuTitle: "Promotions",
    permission: "academics.promotion.view",
  },
] as const satisfies readonly ModuleSection[];
