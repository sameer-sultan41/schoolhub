"use client";

import { useTranslations } from "next-intl";
import { Badge } from "@schoolhub/ui";
import {
  CalendarOff,
  Check,
  Clock,
  Hourglass,
  Plane,
  ShieldCheck,
  X,
  type LucideIcon,
} from "lucide-react";

import type { AttendanceStatus, StaffAttendanceStatus } from "@/services";

/** A student's or a staff member's status: staff have `holiday`, students `excused`. */
export type AnyAttendanceStatus = AttendanceStatus | StaffAttendanceStatus;

/** Each status's icon: a status is never told by colour alone. */
export const ATTENDANCE_STATUS_ICON: Record<AnyAttendanceStatus, LucideIcon> = {
  present: Check,
  absent: X,
  late: Clock,
  half_day: Hourglass,
  excused: ShieldCheck,
  on_leave: Plane,
  holiday: CalendarOff,
};

/** Whether `value` is any status a student's or a staff member's row can hold. */
export function isAnyAttendanceStatus(value: string | null): value is AnyAttendanceStatus {
  return value !== null && Object.hasOwn(ATTENDANCE_STATUS_ICON, value);
}

/** Each status's theme colour, as a `Badge` variant. */
export const ATTENDANCE_STATUS_VARIANT: Record<
  AnyAttendanceStatus,
  "success" | "destructive" | "warning" | "info" | "rose" | "secondary"
> = {
  present: "success",
  absent: "destructive",
  late: "warning",
  half_day: "info",
  excused: "rose",
  on_leave: "secondary",
  // The school was shut: neutral like leave, told apart by its icon and label.
  holiday: "secondary",
};

/** The selected state of a status toggle, in the same theme colour as its badge. */
export const ATTENDANCE_STATUS_SELECTED_CLASS: Record<AnyAttendanceStatus, string> = {
  present: "data-[state=on]:bg-success data-[state=on]:text-success-foreground",
  absent: "data-[state=on]:bg-destructive data-[state=on]:text-destructive-foreground",
  late: "data-[state=on]:bg-warning data-[state=on]:text-warning-foreground",
  half_day: "data-[state=on]:bg-info data-[state=on]:text-info-foreground",
  excused: "data-[state=on]:bg-rose data-[state=on]:text-rose-foreground",
  on_leave: "data-[state=on]:bg-secondary data-[state=on]:text-secondary-foreground",
  holiday: "data-[state=on]:bg-secondary data-[state=on]:text-secondary-foreground",
};

/** A status as colour, icon and label together (`attendance.status.*`). */
export function AttendanceStatusBadge({ status }: { status: AnyAttendanceStatus }) {
  const t = useTranslations("attendance");
  const Icon = ATTENDANCE_STATUS_ICON[status];
  return (
    <Badge variant={ATTENDANCE_STATUS_VARIANT[status]} appearance="light">
      <Icon aria-hidden="true" />
      {t(`status.${status}`)}
    </Badge>
  );
}
