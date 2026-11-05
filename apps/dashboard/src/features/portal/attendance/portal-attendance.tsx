"use client";

import { useMemo, useState } from "react";
import { Badge, Calendar, Card, CardContent, EmptyState, Skeleton } from "@schoolhub/ui";
import { endOfMonth, isSameMonth, parseISO, startOfMonth } from "date-fns";
import { CalendarDays } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import { LoadErrorCard } from "@/components/load-error-card";
import { formatDate } from "@/lib/helpers";
import type { AttendanceStatus, PortalChild, StudentAttendanceRecord } from "@/services";
import { formatDecimal } from "@/features/portal/format-decimal";
import { usePortalSummary } from "@/features/portal/use-portal-summary";
import { ChildGate } from "@/features/portal/shell/child-gate";
import {
  ATTENDANCE_STATUS_DAY_CLASS,
  ATTENDANCE_STATUS_LABEL_KEY,
  ATTENDANCE_STATUS_SEVERITY,
} from "./attendance-status";
import { useRangeAttendance } from "./use-range-attendance";
import { enumLabel } from "@/features/portal/enum-label";

function isStatus(key: string): key is AttendanceStatus {
  return key in ATTENDANCE_STATUS_LABEL_KEY;
}

/** Every status, from the exhaustive label map (L32), with no cast. */
const STATUSES: readonly AttendanceStatus[] = Object.keys(ATTENDANCE_STATUS_LABEL_KEY).filter(
  isStatus,
);

/** One status per day: a day with several rows (period mode) shows its most concerning one. */
function statusByDate(records: readonly StudentAttendanceRecord[]): Map<string, AttendanceStatus> {
  const byDate = new Map<string, AttendanceStatus>();
  for (const record of records) {
    const seen = byDate.get(record.attendance_date);
    if (
      seen === undefined ||
      ATTENDANCE_STATUS_SEVERITY[record.status] > ATTENDANCE_STATUS_SEVERITY[seen]
    ) {
      byDate.set(record.attendance_date, record.status);
    }
  }
  return byDate;
}

/** One child's attendance: a month on the calendar, a day-by-day list for the same month, and
 * (this month only) the percentage the server computed for the summary card. */
export function PortalAttendance() {
  return <ChildGate>{(child) => <ChildAttendance child={child} />}</ChildGate>;
}

function ChildAttendance({ child }: { child: PortalChild }) {
  const t = useTranslations("portal.attendance");
  const locale = useLocale();
  const summary = usePortalSummary();
  const studentId = child.student.id;
  // "This month" is the month of the date the server built the summary for (the school's
  // local date); the viewer's own clock is never consulted.
  const asOf = summary.data?.as_of;
  const currentMonth = asOf === undefined ? undefined : startOfMonth(parseISO(asOf));
  const [picked, setPicked] = useState<Date | null>(null);
  const monthFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }),
    [locale],
  );
  const month = picked ?? currentMonth;

  const records = useRangeAttendance(studentId, month && { from: month, to: endOfMonth(month) });
  const days = useMemo(() => statusByDate(records.data ?? []), [records.data]);
  const dayList = useMemo(() => [...days.entries()].sort(([a], [b]) => a.localeCompare(b)), [days]);
  const modifiers = useMemo(() => {
    const byStatus = {} as Record<AttendanceStatus, Date[]>;
    for (const status of STATUSES) byStatus[status] = [];
    for (const [date, status] of days) byStatus[status].push(parseISO(date));
    return byStatus;
  }, [days]);

  // The server's card is for the current month; any other month has no server percentage.
  const monthPercentage =
    month !== undefined && currentMonth !== undefined && isSameMonth(month, currentMonth)
      ? child.attendance?.month_percentage
      : null;

  function body() {
    if (month === undefined || records.isPending) return <Skeleton className="h-72 w-full" />;
    if (records.isError) {
      return (
        <LoadErrorCard
          message={t("loadError")}
          onRetry={() => {
            void records.refetch();
          }}
        />
      );
    }
    return (
      <Card>
        <CardContent className="space-y-5">
          <Calendar
            month={month}
            onMonthChange={(next) => {
              setPicked(startOfMonth(next));
            }}
            showOutsideDays={false}
            modifiers={modifiers}
            modifiersClassNames={ATTENDANCE_STATUS_DAY_CLASS}
          />
          <ul className="flex flex-wrap gap-2" aria-label={t("legend")}>
            {STATUSES.map((status) => (
              <li key={status}>
                <Badge variant="outline" size="sm">
                  {enumLabel(t, ATTENDANCE_STATUS_LABEL_KEY, status)}
                </Badge>
              </li>
            ))}
          </ul>
          {dayList.length === 0 ? (
            <EmptyState
              icon={CalendarDays}
              title={t("emptyTitle")}
              description={t("emptyDescription")}
            />
          ) : (
            <table className="w-full text-sm">
              <caption className="sr-only">
                {t("caption", { month: monthFormatter.format(month) })}
              </caption>
              <tbody>
                {dayList.map(([date, status]) => (
                  <tr key={date} className="border-t border-border">
                    <th scope="row" className="py-2 text-start font-normal">
                      {formatDate(date, locale)}
                    </th>
                    <td className="py-2 text-end">
                      {enumLabel(t, ATTENDANCE_STATUS_LABEL_KEY, status)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <section className="space-y-4">
      <h1 className="font-heading text-xl font-semibold text-foreground">{t("title")}</h1>
      {monthPercentage ? (
        <p className="text-sm text-muted-foreground">
          {t("monthPercentage", { value: formatDecimal(locale, monthPercentage, 1) })}
        </p>
      ) : null}
      {body()}
    </section>
  );
}
