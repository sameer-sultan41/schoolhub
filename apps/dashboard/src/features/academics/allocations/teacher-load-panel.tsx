"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import {
  Badge,
  BadgeDot,
  Card,
  CardContent,
  EmptyState,
  Skeleton,
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@schoolhub/ui";
import { Gauge } from "lucide-react";

import { LoadErrorCard } from "@/components/load-error-card";
import { resolveErrorMessage } from "@/lib/error-message";
import { queryKeys } from "@/lib/query-client";
import { Services } from "@/services";
import {
  ALLOCATION_LOAD_SUMMARY_RESOURCE,
  ALLOCATION_QUERY_MODULE,
} from "@/services/modules/teacher-allocations/teacher-allocations-constant";
import { sortOverNormFirst } from "@/services/modules/teacher-allocations/teacher-allocations-helper";

export interface TeacherLoadPanelProps {
  /** The session the screen shows, or `""` while there is none: nothing is requested then. */
  sessionId: string;
}

/**
 * Each teacher's weekly load in the session against the norm, over-norm first. Held under
 * `teacher-allocations`, shared with the dashboard widget, so an allocation write refreshes it.
 */
export function TeacherLoadPanel({ sessionId }: TeacherLoadPanelProps) {
  const t = useTranslations("academics");
  const tErrors = useTranslations("errors");

  const query = useQuery({
    queryKey: queryKeys.list(ALLOCATION_QUERY_MODULE, ALLOCATION_LOAD_SUMMARY_RESOURCE, {
      sessionId,
    }),
    queryFn: () => Services.teacherAllocations.fetchLoadSummary(sessionId),
    enabled: sessionId !== "",
  });
  const rows = useMemo(() => sortOverNormFirst(query.data ?? []), [query.data]);

  if (sessionId === "") return null;

  if (query.isError) {
    return (
      <LoadErrorCard
        message={resolveErrorMessage(query.error, tErrors, t("loadSummary.loadError"))}
        onRetry={() => {
          void query.refetch();
        }}
      />
    );
  }

  const norm = rows[0]?.norm;

  return (
    <Card className="mb-5">
      <CardContent className="space-y-3">
        <div className="space-y-1">
          <h2 className="text-sm font-medium text-foreground">{t("loadSummary.title")}</h2>
          {norm !== undefined && (
            <p className="text-xs text-muted-foreground">{t("loadSummary.normHint", { norm })}</p>
          )}
        </div>
        {query.isPending ? (
          <div role="status" aria-label={t("loadSummary.loading")}>
            <Skeleton className="h-24 w-full" />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={Gauge}
            title={t("loadSummary.emptyTitle")}
            description={t("loadSummary.emptyDescription")}
          />
        ) : (
          <Table frame="none">
            <TableCaption className="sr-only">{t("loadSummary.title")}</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead>{t("fields.teacher")}</TableHead>
                <TableHead className="text-end">{t("loadSummary.columns.allocations")}</TableHead>
                <TableHead className="text-end">{t("loadSummary.columns.weeklyPeriods")}</TableHead>
                <TableHead>{t("loadSummary.columns.status")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.staff_id}>
                  <TableCell>{row.name}</TableCell>
                  <TableCell className="text-end">{row.allocations}</TableCell>
                  <TableCell className="text-end">{row.weekly_periods}</TableCell>
                  <TableCell>
                    {row.over_norm ? (
                      <Badge variant="destructive" appearance="light">
                        <BadgeDot />
                        {t("loadSummary.overNorm")}
                      </Badge>
                    ) : (
                      <Badge variant="success" appearance="light">
                        <BadgeDot />
                        {t("loadSummary.withinNorm")}
                      </Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
