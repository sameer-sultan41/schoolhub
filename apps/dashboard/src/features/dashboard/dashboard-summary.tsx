"use client";

import { ApiError } from "@schoolhub/api-client";
import {
  Alert,
  AlertDescription,
  Card,
  CardContent,
  CardDescription,
  CardTitle,
  Skeleton,
} from "@schoolhub/ui";
import { useQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { useSession } from "@/hooks/use-session";
import { apiClient } from "@/lib/auth";
import { formatCount, formatMinorUnits, formatPercent } from "@/lib/format";
import { hasPermission } from "@/lib/permissions";
import { queryKeys } from "@/lib/query-client";

interface DashboardStats {
  students_enrolled: number;
  attendance_rate_today: number | null;
  fees_outstanding_minor_units: number;
  open_admission_enquiries: number;
  currency: string;
}

/**
 * Each tile is permission-gated: a user without `fees.invoice.view` simply never sees the
 * outstanding-fees figure. The API would refuse the underlying call regardless.
 */
export function DashboardSummary() {
  const t = useTranslations("dashboard");
  const tErrors = useTranslations("errors");
  const locale = useLocale();
  const { user } = useSession();

  const { data, isPending, error } = useQuery({
    queryKey: queryKeys.list("reporting", "dashboard-summary"),
    queryFn: async () => (await apiClient.get<DashboardStats>("/reports/dashboard-summary")).data,
  });

  if (error instanceof ApiError) {
    return (
      <Alert variant="danger">
        <AlertDescription>
          {tErrors.has(error.code) ? tErrors(error.code) : error.message}
          {error.requestId ? ` ${tErrors("requestId", { requestId: error.requestId })}` : ""}
        </AlertDescription>
      </Alert>
    );
  }

  const tiles = [
    {
      key: "students",
      permission: "students.student.view" as const,
      value: data ? formatCount(data.students_enrolled, locale) : "—",
    },
    {
      key: "attendanceToday",
      permission: "attendance.student-attendance.view" as const,
      value:
        data && data.attendance_rate_today !== null
          ? formatPercent(data.attendance_rate_today, locale)
          : "—",
    },
    {
      key: "feesOutstanding",
      permission: "fees.invoice.view" as const,
      value: data
        ? formatMinorUnits(data.fees_outstanding_minor_units, data.currency, locale)
        : "—",
    },
    {
      key: "openAdmissions",
      permission: "admissions.enquiry.view" as const,
      value: data ? formatCount(data.open_admission_enquiries, locale) : "—",
    },
  ];

  // Filtered before mapping, not per-tile via <Can>: the stagger delay below is
  // `index * 60ms`, and index must come from the tiles actually being RENDERED — a
  // per-tile <Can> wrapper hides children after this array (and its indices) are already
  // fixed, so a role missing one permission mid-list saw its remaining tiles jump straight
  // to their original, now-gapped delays instead of a smooth 0/60/120/180ms stagger.
  const visibleTiles = tiles.filter((tile) => hasPermission(user, tile.permission));

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {visibleTiles.map((tile, index) => (
        // The signature moment's second half (the woven rule above is the first): the
        // tiles stagger in at 60ms intervals rather than popping in together. A fixed
        // per-index delay via inline style, since Tailwind utilities can't express "the
        // Nth item" — motion-reduce:animate-none turns it off entirely rather than just
        // speeding it up, matching the woven rule's own reduced-motion behaviour.
        <Card
          key={tile.key}
          className="animate-in fill-mode-backwards fade-in slide-in-from-bottom-2 motion-reduce:animate-none"
          style={{ animationDelay: `${index * 60}ms`, animationDuration: "400ms" }}
        >
          <CardContent className="space-y-2 pt-6">
            <CardDescription>{t(`cards.${tile.key}`)}</CardDescription>
            <CardTitle className="text-2xl tabular-nums">
              {isPending ? <Skeleton className="h-7 w-20" /> : tile.value}
            </CardTitle>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
