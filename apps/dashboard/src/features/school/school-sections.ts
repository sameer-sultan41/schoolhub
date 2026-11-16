import type { ModuleSection } from "@/components/module-sections/module-sections";
import { Paths } from "@/config/paths";
import {
  anyWriteKey,
  CAMPUS_KEYS,
  DEPARTMENT_KEYS,
  HOUSE_KEYS,
  SCHOOL_SETTINGS_UPDATE,
} from "./school-permissions";

/**
 * The one list of School sections (permission prefix `school`), in tab order: tabs, the
 * `/school` landing and the sidebar's children all derive from it. These are setup screens,
 * so each is gated on its resource's write keys, not its view key: every staff role holds the
 * `.view` keys, which would put a read-only School module in front of every teacher.
 */
export const SCHOOL_SECTIONS = [
  {
    href: Paths.SCHOOL_PROFILE,
    labelKey: "nav.profile",
    menuTitle: "Profile & settings",
    permission: SCHOOL_SETTINGS_UPDATE,
  },
  {
    href: Paths.SCHOOL_CAMPUSES,
    labelKey: "nav.campuses",
    menuTitle: "Campuses",
    permission: anyWriteKey(CAMPUS_KEYS),
  },
  {
    href: Paths.SCHOOL_DEPARTMENTS,
    labelKey: "nav.departments",
    menuTitle: "Departments",
    permission: anyWriteKey(DEPARTMENT_KEYS),
  },
  {
    href: Paths.SCHOOL_HOUSES,
    labelKey: "nav.houses",
    menuTitle: "Houses",
    permission: anyWriteKey(HOUSE_KEYS),
  },
  {
    href: Paths.SCHOOL_CALENDAR,
    labelKey: "nav.calendar",
    menuTitle: "Calendar",
    permission: SCHOOL_SETTINGS_UPDATE,
  },
] as const satisfies readonly ModuleSection[];
