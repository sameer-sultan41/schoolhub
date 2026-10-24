import type { ModuleSection } from "@/components/module-sections/module-sections";
import { Paths } from "@/config/paths";

/**
 * The one list of Timetable sections, in tab order: tabs, the `/timetable` landing and the
 * sidebar's children all derive from it. My timetable is last, so a builder lands on the grid
 * and a teacher, holding only its key, lands on their own week. A tab is gated on the key its screen's writes need
 * where §4 declares no view key of its own (periods and rooms are read with
 * `timetable.timetable.view`, which every role holds, so that key would open the setup
 * screens to teachers and guardians).
 */
export const TIMETABLE_SECTIONS = [
  {
    href: Paths.TIMETABLE_GRID,
    labelKey: "nav.grid",
    menuTitle: "Week grid",
    // The draft key: the grid shows drafts, which never reach students or guardians (§5.7).
    permission: "timetable.slot.view",
  },
  {
    href: Paths.TIMETABLE_PERIODS,
    labelKey: "nav.periods",
    menuTitle: "Periods",
    permission: "timetable.period.update",
  },
  {
    href: Paths.TIMETABLE_ROOMS,
    labelKey: "nav.rooms",
    menuTitle: "Rooms",
    permission: "timetable.room.update",
  },
  {
    href: Paths.TIMETABLE_SUBSTITUTIONS,
    labelKey: "nav.substitutions",
    menuTitle: "Substitutions",
    // A proposer or an approver of cover: two roles, two keys.
    permission: ["timetable.substitution.create", "timetable.substitution.approve"],
  },
  {
    href: Paths.TIMETABLE_MY,
    labelKey: "nav.my",
    menuTitle: "My timetable",
    // Every role holds it, so a teacher (or anyone with no other section) lands here.
    permission: "timetable.timetable.view",
  },
] as const satisfies readonly ModuleSection[];
