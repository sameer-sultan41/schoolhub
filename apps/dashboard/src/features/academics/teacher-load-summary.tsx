"use client";

import { Badge, Card, CardContent, DataTable, type DataTableColumn } from "@schoolhub/ui";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { DEFAULT_WEEKLY_PERIOD_NORM } from "@/features/academics/academics-constants";
import { ApiErrorAlert } from "@/features/academics/academics-error-alert";
import type { TeacherLoadSummaryRow } from "@/features/academics/academics-types";
import { apiClient } from "@/lib/auth";
import { queryKeys } from "@/lib/query-client";

interface TeacherLoadSummaryProps {
  academicSessionId: string;
}

/**
 * Per-teacher weekly load for one session (§5.3, §5.6) — the counter the
 * vice_principal watches while dragging teachers onto sections in §8.
 *
 * `over_norm` comes from the server, which owns the norm; the constant here only
 * labels the threshold. The endpoint returns a plain array (no pagination meta),
 * and it honours record scope — a teacher sees only their own row, exactly as
 * they do in the allocation list.
 */
export function TeacherLoadSummary({ academicSessionId }: TeacherLoadSummaryProps) {
  const t = useTranslations("academics");

  const { data, isPending, error } = useQuery({
    queryKey: queryKeys.list("academics", "teacher-load-summary", {
      academic_session_id: academicSessionId,
    }),
    queryFn: async () =>
      (
        await apiClient.get<TeacherLoadSummaryRow[]>("/teacher-subject-allocations/load-summary", {
          query: { academic_session_id: academicSessionId },
        })
      ).data,
  });

  const columns: DataTableColumn<TeacherLoadSummaryRow>[] = [
    { id: "name", header: t("fields.teacher"), cell: (row) => row.name },
    {
      id: "allocations",
      header: t("loadSummary.columns.allocations"),
      className: "tabular-nums",
      cell: (row) => row.allocations,
    },
    {
      id: "weeklyPeriods",
      header: t("loadSummary.columns.weeklyPeriods"),
      className: "tabular-nums",
      cell: (row) => row.weekly_periods,
    },
    {
      id: "status",
      header: t("loadSummary.columns.status"),
      cell: (row) =>
        row.over_norm ? (
          <Badge variant="danger">{t("loadSummary.overNorm")}</Badge>
        ) : (
          <Badge variant="success">{t("loadSummary.withinNorm")}</Badge>
        ),
    },
  ];

  return (
    <Card>
      <CardContent className="space-y-3 pt-6">
        <div className="space-y-1">
          <h2 className="text-sm font-medium text-foreground">{t("loadSummary.title")}</h2>
          <p className="text-xs text-muted-foreground">
            {t("loadSummary.normHint", { norm: DEFAULT_WEEKLY_PERIOD_NORM })}
          </p>
        </div>

        <ApiErrorAlert error={error} />

        {error ? null : (
          <DataTable
            columns={columns}
            rows={data ?? []}
            getRowId={(row) => row.staff_id}
            caption={t("loadSummary.title")}
            isLoading={isPending}
            emptyState={t("loadSummary.empty")}
          />
        )}
      </CardContent>
    </Card>
  );
}
