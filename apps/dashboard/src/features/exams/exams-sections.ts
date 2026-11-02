import type { ModuleSection } from "@/components/module-sections/module-sections";
import { Paths } from "@/config/paths";

/**
 * The one list of Examinations sections, in tab order: tabs, the `/exams` landing and the
 * sidebar's children all derive from it. Final order: Exams, Grading scales, Reports, Question
 * banks; each PR adds its own in that place. Exams is the landing's own path: `/exams` shows its
 * list to a holder of `exams.exam.view` and redirects anyone else to their first permitted
 * section, so it must not redirect a viewer who holds that key (see `exams/page.tsx`).
 */
export const EXAMS_SECTIONS = [
  {
    href: Paths.EXAMS,
    labelKey: "nav.exams",
    menuTitle: "Exams",
    permission: "exams.exam.view",
  },
  {
    href: Paths.EXAMS_GRADING_SCALES,
    labelKey: "nav.gradingScales",
    menuTitle: "Grading scales",
    permission: "exams.grading-scale.view",
  },
  {
    href: Paths.EXAMS_REPORTS,
    labelKey: "nav.reports",
    menuTitle: "Reports",
    permission: "exams.result.view",
  },
] as const satisfies readonly ModuleSection[];
