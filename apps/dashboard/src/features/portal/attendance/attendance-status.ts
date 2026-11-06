import type { AttendanceStatus } from "@/services";

/** Every status the API can send, to its message key under `portal.attendance`. Typed over
 * the generated enum so a new status is a compile error here, not a blank label (L32). */
export const ATTENDANCE_STATUS_LABEL_KEY: Record<AttendanceStatus, `status.${AttendanceStatus}`> = {
  present: "status.present",
  absent: "status.absent",
  late: "status.late",
  half_day: "status.half_day",
  excused: "status.excused",
  on_leave: "status.on_leave",
};

/** The calendar cell fill for each status: theme tokens only. */
export const ATTENDANCE_STATUS_DAY_CLASS: Record<AttendanceStatus, string> = {
  present: "[&>button]:bg-success [&>button]:text-success-foreground",
  absent: "[&>button]:bg-destructive [&>button]:text-destructive-foreground",
  late: "[&>button]:bg-warning [&>button]:text-warning-foreground",
  half_day: "[&>button]:bg-warning [&>button]:text-warning-foreground",
  excused: "[&>button]:bg-secondary [&>button]:text-secondary-foreground",
  on_leave: "[&>button]:bg-rose [&>button]:text-rose-foreground",
};

/** The status a day shows when it has several rows (period mode): the most concerning one. */
export const ATTENDANCE_STATUS_SEVERITY: Record<AttendanceStatus, number> = {
  present: 0,
  on_leave: 1,
  excused: 2,
  half_day: 3,
  late: 4,
  absent: 5,
};
