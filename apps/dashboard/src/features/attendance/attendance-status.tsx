"use client";

import { useTranslations } from "next-intl";
import { Badge } from "@schoolhub/ui";
import { Check, Clock, Hourglass, Plane, ShieldCheck, X, type LucideIcon } from "lucide-react";

import type { AttendanceStatus } from "@/services";

/** Each status's icon: a status is never told by colour alone. */
export const ATTENDANCE_STATUS_ICON: Record<AttendanceStatus, LucideIcon> = {
  present: Check,
  absent: X,
  late: Clock,
  half_day: Hourglass,
  excused: ShieldCheck,
  on_leave: Plane,
};

/** Each status's theme colour, as a `Badge` variant. */
export const ATTENDANCE_STATUS_VARIANT: Record<
  AttendanceStatus,
  "success" | "destructive" | "warning" | "info" | "rose" | "secondary"
> = {
  present: "success",
  absent: "destructive",
  late: "warning",
  half_day: "info",
  excused: "rose",
  on_leave: "secondary",
};

/** The selected state of a status toggle, in the same theme colour as its badge. */
export const ATTENDANCE_STATUS_SELECTED_CLASS: Record<AttendanceStatus, string> = {
  present: "data-[state=on]:bg-success data-[state=on]:text-success-foreground",
  absent: "data-[state=on]:bg-destructive data-[state=on]:text-destructive-foreground",
  late: "data-[state=on]:bg-warning data-[state=on]:text-warning-foreground",
  half_day: "data-[state=on]:bg-info data-[state=on]:text-info-foreground",
  excused: "data-[state=on]:bg-rose data-[state=on]:text-rose-foreground",
  on_leave: "data-[state=on]:bg-secondary data-[state=on]:text-secondary-foreground",
};

/** A status as colour, icon and label together (`attendance.status.*`). */
export function AttendanceStatusBadge({ status }: { status: AttendanceStatus }) {
  const t = useTranslations("attendance");
  const Icon = ATTENDANCE_STATUS_ICON[status];
  return (
    <Badge variant={ATTENDANCE_STATUS_VARIANT[status]} appearance="light">
      <Icon aria-hidden="true" />
      {t(`status.${status}`)}
    </Badge>
  );
}
