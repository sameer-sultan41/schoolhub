import type { ModuleSection } from "@/components/module-sections/module-sections";
import { Paths } from "@/config/paths";

/**
 * The one list of Attendance sections, in tab order: tabs, the `/attendance` landing and the
 * sidebar's children all derive from it. Final order: Register, Records, Corrections, Leave,
 * Staff, Reports, Settings; each later PR appends its own sections before Settings. Every tab
 * is gated on the key its screen needs (`attendance.md` §4), so a viewer lands on the first
 * screen they may open.
 */
export const ATTENDANCE_SECTIONS = [
  {
    href: Paths.ATTENDANCE_REGISTER,
    labelKey: "nav.register",
    menuTitle: "Register",
    permission: "attendance.student-attendance.mark",
  },
  {
    href: Paths.ATTENDANCE_RECORDS,
    labelKey: "nav.records",
    menuTitle: "Records",
    permission: "attendance.student-attendance.view",
  },
  {
    href: Paths.ATTENDANCE_CORRECTIONS,
    labelKey: "nav.corrections",
    menuTitle: "Corrections",
    // A requester sees their own requests and an approver the queue; the API scopes each.
    permission: ["attendance.correction.create", "attendance.correction.approve"],
  },
  {
    href: Paths.ATTENDANCE_LEAVE,
    labelKey: "nav.leave",
    menuTitle: "Leave",
    // The leave catalogue and the queue share this key; approving needs `.approve` as well.
    permission: "attendance.leave-request.view",
  },
  {
    href: Paths.ATTENDANCE_SETTINGS,
    labelKey: "nav.settings",
    menuTitle: "Settings",
    // Reading the settings needs `school.settings.view`; this tab is for changing them.
    permission: "school.settings.update",
  },
] as const satisfies readonly ModuleSection[];
