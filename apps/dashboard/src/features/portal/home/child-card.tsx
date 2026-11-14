"use client";

import Link from "next/link";
import { Card, CardContent } from "@schoolhub/ui";
import { useLocale, useTranslations } from "next-intl";

import { Paths } from "@/config/paths";
import { formatDate } from "@/lib/helpers";
import type { PortalChild } from "@/services";
import { ATTENDANCE_STATUS_LABEL_KEY } from "@/features/portal/attendance/attendance-status";
import { formatDecimal } from "@/lib/format-decimal";
import { enumLabel } from "@/lib/enum-label";

/** One child's summary: the cards the server sent, and none it left `null` (a module that is
 * off or a key the viewer lacks leaves its card out, not blank). */
export function ChildCard({ child, linked = true }: { child: PortalChild; linked?: boolean }) {
  const t = useTranslations("portal.home");
  const tAttendance = useTranslations("portal.attendance");
  const locale = useLocale();
  const { student, attendance, fees, latest_result: result } = child;
  const name = `${student.first_name} ${student.last_name}`;
  const classLine = [student.class_name, student.section_name].filter(Boolean).join(" · ");

  return (
    <Card>
      <CardContent className="space-y-4">
        <div className="space-y-1">
          <h2 className="font-heading text-lg font-semibold text-foreground">
            {linked ? (
              <Link
                href={Paths.PORTAL_CHILD(student.id)}
                className="underline-offset-4 hover:underline"
              >
                {name}
              </Link>
            ) : (
              name
            )}
          </h2>
          <p className="text-sm text-muted-foreground">
            {[classLine, student.admission_number].filter(Boolean).join(" · ")}
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {attendance ? (
            <Link
              href={Paths.PORTAL_ATTENDANCE(student.id)}
              className="space-y-1 rounded-lg border border-border p-3"
            >
              <p className="text-xs text-muted-foreground">{t("attendance.title")}</p>
              <p className="font-medium">
                {attendance.today
                  ? enumLabel(tAttendance, ATTENDANCE_STATUS_LABEL_KEY, attendance.today)
                  : t("attendance.notMarked")}
              </p>
              {attendance.month_percentage ? (
                <p className="text-xs text-muted-foreground">
                  {t("attendance.month", {
                    value: formatDecimal(locale, attendance.month_percentage, 1),
                  })}
                </p>
              ) : null}
            </Link>
          ) : null}
          {fees ? (
            <Link
              href={Paths.PORTAL_FEES(student.id)}
              className="space-y-1 rounded-lg border border-border p-3"
            >
              <p className="text-xs text-muted-foreground">{t("fees.title")}</p>
              <p className="font-medium tabular-nums">
                {formatDecimal(locale, fees.outstanding_total)}
              </p>
              <p className="text-xs text-muted-foreground">
                {fees.outstanding_count === 0
                  ? t("fees.none")
                  : t("fees.count", { count: fees.outstanding_count })}
                {fees.next_due_date
                  ? ` · ${t("fees.nextDue", { date: formatDate(fees.next_due_date, locale) })}`
                  : ""}
              </p>
            </Link>
          ) : null}
          {result ? (
            <Link
              href={Paths.PORTAL_RESULTS(student.id)}
              className="space-y-1 rounded-lg border border-border p-3"
            >
              <p className="text-xs text-muted-foreground">{t("result.title")}</p>
              <p className="font-medium">{result.exam_name}</p>
              <p className="text-xs text-muted-foreground tabular-nums">
                {t("result.percentage", { value: formatDecimal(locale, result.percentage, 1) })}
                {result.grade ? ` · ${result.grade}` : ""}
              </p>
            </Link>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
