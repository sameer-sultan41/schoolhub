"use client";

import { ApiError } from "@schoolhub/api-client";
import { Card, CardContent, CardDescription, CardTitle } from "@schoolhub/ui";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Can } from "@/components/can";
import { apiClient } from "@/lib/auth";
import { queryKeys } from "@/lib/query-client";

interface DashboardStats {
  students_enrolled: number;
  attendance_rate_today: number | null;
  fees_outstanding_minor_units: number;
  open_admission_enquiries: number;
  currency: string;
}

function formatMinorUnits(amount: number, currency: string, locale: string): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(amount / 100);
}

/**
 * Each tile is permission-gated: a user without `fees.invoice.view` simply never sees the
 * outstanding-fees figure. The API would refuse the underlying call regardless.
 */
export function DashboardSummary() {
  const t = useTranslations("dashboard");
  const tErrors = useTranslations("errors");

  const { data, isPending, error } = useQuery({
    queryKey: queryKeys.list("reporting", "dashboard-summary"),
    queryFn: async () => (await apiClient.get<DashboardStats>("/reports/dashboard-summary")).data,
  });

  if (error instanceof ApiError) {
    return (
      <p role="alert" className="text-sm text-danger">
        {tErrors.has(error.code) ? tErrors(error.code) : error.message}
        {error.requestId ? ` ${tErrors("requestId", { requestId: error.requestId })}` : ""}
      </p>
    );
  }

  const tiles = [
    {
      key: "students",
      permission: "students.student.view" as const,
      value: data ? String(data.students_enrolled) : "—",
    },
    {
      key: "attendanceToday",
      permission: "attendance.student-attendance.view" as const,
      value: data && data.attendance_rate_today !== null ? `${data.attendance_rate_today}%` : "—",
    },
    {
      key: "feesOutstanding",
      permission: "fees.invoice.view" as const,
      value: data ? formatMinorUnits(data.fees_outstanding_minor_units, data.currency, "en") : "—",
    },
    {
      key: "openAdmissions",
      permission: "admissions.enquiry.view" as const,
      value: data ? String(data.open_admission_enquiries) : "—",
    },
  ];

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {tiles.map((tile) => (
        <Can key={tile.key} permission={tile.permission}>
          <Card>
            <CardContent className="space-y-2 pt-6">
              <CardDescription>{t(`cards.${tile.key}`)}</CardDescription>
              <CardTitle className="text-2xl tabular-nums">
                {isPending ? (
                  <span className="block h-7 w-20 animate-pulse rounded bg-muted" />
                ) : (
                  tile.value
                )}
              </CardTitle>
            </CardContent>
          </Card>
        </Can>
      ))}
    </div>
  );
}
