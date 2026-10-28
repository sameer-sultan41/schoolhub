"use client";

import { useMemo, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { ColumnDef } from "@tanstack/react-table";

import { AttendanceStatusBadge } from "@/features/attendance/attendance-status";
import { RequestStatusBadge } from "@/features/attendance/request-status-badge";
import { EMPTY_VALUE } from "@/lib/constants";
import { formatDate } from "@/lib/helpers";
import type { ReportKind, ReportRowOf } from "@/services";
import { formatOneDecimal } from "@/services/modules/attendance-reports/attendance-reports-helper";
import { formatLeaveDays } from "@/services/modules/leave-requests/leave-requests-helper";
import { toShortTime } from "@/services/modules/periods/periods-helper";

/** Each kind's columns, typed on that kind's row. */
export type ReportColumns = { [K in ReportKind]: ColumnDef<ReportRowOf<K>>[] };

type Translate = ReturnType<typeof useTranslations>;

/** The fields a person's cell reads: a student's or a staff member's. */
interface PersonRow {
  first_name: string;
  last_name: string;
}

/** A plain column: a translated header and a cell. Report columns are never sorted. */
function column<TRow>(id: string, title: string, cell: (row: TRow) => ReactNode): ColumnDef<TRow> {
  return {
    id,
    enableSorting: false,
    header: () => title,
    cell: ({ row }) => cell(row.original),
    meta: { headerTitle: title },
  };
}

/** A count that may be null (no minutes at all), shown as a dash. */
function countOrDash(value: number | null): string | number {
  return value ?? EMPTY_VALUE;
}

/** A name, with the admission or employee number under it when the row has one. */
function personColumn<TRow extends PersonRow>(
  t: Translate,
  id: string,
  title: string,
  secondary?: (row: TRow) => string,
): ColumnDef<TRow> {
  return column<TRow>(id, title, (row) => (
    <span className="block">
      <span className="block">
        {t("reports.fullName", { first: row.first_name, last: row.last_name })}
      </span>
      {secondary && <span className="block text-xs text-muted-foreground">{secondary(row)}</span>}
    </span>
  ));
}

/** The day counts and the rate, shared by the student summary and the defaulters. */
function rateColumns<TRow extends ReportRowOf<"student-summary"> | ReportRowOf<"defaulters">>(
  t: Translate,
  locale: string,
): ColumnDef<TRow>[] {
  return [
    personColumn<TRow>(t, "student", t("reports.columns.student"), (row) => row.admission_number),
    column<TRow>("present", t("reports.columns.presentDays"), (row) => row.present_days),
    column<TRow>("absent", t("reports.columns.absentDays"), (row) => row.absent_days),
    column<TRow>("late", t("reports.columns.lateDays"), (row) => row.late_days),
    column<TRow>("leave", t("reports.columns.leaveDays"), (row) => row.leave_days),
    column<TRow>("counted", t("reports.columns.countedDays"), (row) => row.counted_days),
    column<TRow>("rate", t("reports.columns.rate"), (row) =>
      t("reports.rate", { rate: formatOneDecimal(row.attendance_rate, locale) }),
    ),
  ];
}

/**
 * The report table's columns for every kind, each list typed on its kind's row, so a cell reads
 * only the fields its report sends. Built once per locale.
 */
export function useReportColumns(): ReportColumns {
  const t = useTranslations("attendance");
  const locale = useLocale();

  return useMemo<ReportColumns>(() => {
    type Daily = ReportRowOf<"daily-register">;
    type Late = ReportRowOf<"student-late-arrivals">;
    type Staff = ReportRowOf<"staff-punctuality">;
    type Leave = ReportRowOf<"leave">;

    return {
      "daily-register": [
        personColumn<Daily>(
          t,
          "student",
          t("reports.columns.student"),
          (row) => row.admission_number,
        ),
        column<Daily>("section", t("reports.columns.section"), (row) => row.section_name),
        // Set only for one period's rows; the derived day has none.
        column<Daily>(
          "period",
          t("reports.columns.period"),
          (row) => row.period_name ?? EMPTY_VALUE,
        ),
        column<Daily>("status", t("reports.columns.status"), (row) => (
          <AttendanceStatusBadge status={row.status} />
        )),
        column<Daily>("checkIn", t("reports.columns.checkIn"), (row) =>
          row.check_in_time ? toShortTime(row.check_in_time) : EMPTY_VALUE,
        ),
        column<Daily>("lateMinutes", t("reports.columns.lateMinutes"), (row) =>
          countOrDash(row.late_minutes),
        ),
        column<Daily>("remarks", t("reports.columns.remarks"), (row) => row.remarks ?? EMPTY_VALUE),
      ],
      "student-summary": rateColumns<ReportRowOf<"student-summary">>(t, locale),
      defaulters: rateColumns<ReportRowOf<"defaulters">>(t, locale),
      "student-late-arrivals": [
        personColumn<Late>(
          t,
          "student",
          t("reports.columns.student"),
          (row) => row.admission_number,
        ),
        column<Late>("lateCount", t("reports.columns.lateCount"), (row) => row.late_count),
        column<Late>("totalLate", t("reports.columns.totalLateMinutes"), (row) =>
          countOrDash(row.total_late_minutes),
        ),
        column<Late>("averageLate", t("reports.columns.averageLateMinutes"), (row) =>
          row.average_late_minutes === null
            ? EMPTY_VALUE
            : formatOneDecimal(row.average_late_minutes, locale),
        ),
      ],
      "staff-punctuality": [
        personColumn<Staff>(t, "staff", t("reports.columns.staff"), (row) => row.employee_number),
        column<Staff>("working", t("reports.columns.workingDays"), (row) => row.working_days),
        column<Staff>("present", t("reports.columns.presentDays"), (row) => row.present_days),
        column<Staff>("absent", t("reports.columns.absentDays"), (row) => row.absent_days),
        column<Staff>("leave", t("reports.columns.leaveDays"), (row) => row.leave_days),
        column<Staff>("lateCount", t("reports.columns.lateCount"), (row) => row.late_count),
        column<Staff>("totalLate", t("reports.columns.totalLateMinutes"), (row) =>
          countOrDash(row.total_late_minutes),
        ),
        column<Staff>("earlyDeparture", t("reports.columns.earlyDepartureMinutes"), (row) =>
          countOrDash(row.total_early_departure_minutes),
        ),
      ],
      leave: [
        personColumn<Leave>(t, "student", t("reports.columns.student")),
        column<Leave>("type", t("reports.columns.leaveType"), (row) => row.leave_type_name),
        column<Leave>("dates", t("reports.columns.dates"), (row) =>
          t("leave.dateRange", {
            from: formatDate(row.start_date, locale),
            to: formatDate(row.end_date, locale),
          }),
        ),
        column<Leave>("days", t("reports.columns.days"), (row) =>
          formatLeaveDays(row.days_count, locale),
        ),
        column<Leave>("dayPart", t("reports.columns.dayPart"), (row) =>
          t(`leave.dayPart.${row.day_part}`),
        ),
        column<Leave>("status", t("reports.columns.status"), (row) => (
          <RequestStatusBadge status={row.status} />
        )),
      ],
    };
  }, [t, locale]);
}
