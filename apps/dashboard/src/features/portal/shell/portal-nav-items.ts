import { Paths } from "@/config/paths";
import type { PortalModules } from "@/services";

/** Every module off: the nav when the summary could not be read, so only the module-free tabs
 * (notifications, settings) remain. */
export const NO_PORTAL_MODULES: PortalModules = {
  attendance: false,
  fees: false,
  examinations: false,
  communication: false,
  timetable: false,
};

/** Portal pages that read nothing from the summary, so a failed summary never blocks them. */
export const SUMMARY_FREE_PATHS: readonly string[] = [
  Paths.PORTAL_NOTIFICATIONS,
  Paths.PORTAL_SETTINGS,
];

export interface PortalNavItem {
  /** The key under `portal.nav` in the messages. */
  labelKey:
    | "overview"
    | "attendance"
    | "leave"
    | "fees"
    | "results"
    | "timetable"
    | "messages"
    | "notices"
    | "notifications"
    | "settings";
  href: string;
}

/**
 * The portal's nav, from the server-computed `modules` flags and nothing else (the dashboard
 * has no feature-flag source of its own). One child's tabs need a `studentId`; without one
 * (no child yet) only the child-free items remain. Notifications and settings have no module
 * flag: the inbox is the user's own mail (ADR-0030).
 */
export function portalNavItems(
  modules: PortalModules,
  studentId: string | undefined,
): PortalNavItem[] {
  const items: PortalNavItem[] = [];
  if (studentId !== undefined) {
    items.push({ labelKey: "overview", href: Paths.PORTAL_CHILD(studentId) });
    if (modules.attendance) {
      items.push({ labelKey: "attendance", href: Paths.PORTAL_ATTENDANCE(studentId) });
      // Leave is the attendance module's, so it follows that flag.
      items.push({ labelKey: "leave", href: Paths.PORTAL_LEAVE(studentId) });
    }
    if (modules.fees) items.push({ labelKey: "fees", href: Paths.PORTAL_FEES(studentId) });
    if (modules.examinations) {
      items.push({ labelKey: "results", href: Paths.PORTAL_RESULTS(studentId) });
    }
    if (modules.timetable) {
      items.push({ labelKey: "timetable", href: Paths.PORTAL_TIMETABLE(studentId) });
    }
  }
  if (modules.communication) {
    items.push({ labelKey: "messages", href: Paths.PORTAL_MESSAGES });
    items.push({ labelKey: "notices", href: Paths.PORTAL_NOTICES });
  }
  items.push({ labelKey: "notifications", href: Paths.PORTAL_NOTIFICATIONS });
  items.push({ labelKey: "settings", href: Paths.PORTAL_SETTINGS });
  return items;
}

/** The page to open when the viewer picks another child: the same section if they are on one
 * child's page, otherwise that child's overview. */
export function switchChildPath(
  pathname: string,
  currentStudentId: string | undefined,
  nextStudentId: string,
): string {
  const prefix = currentStudentId === undefined ? null : Paths.PORTAL_CHILD(currentStudentId);
  if (prefix !== null && (pathname === prefix || pathname.startsWith(`${prefix}/`))) {
    return `${Paths.PORTAL_CHILD(nextStudentId)}${pathname.slice(prefix.length)}`;
  }
  return Paths.PORTAL_CHILD(nextStudentId);
}
