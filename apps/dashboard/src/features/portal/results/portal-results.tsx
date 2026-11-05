"use client";

import { useQuery } from "@tanstack/react-query";
import { Badge, Card, CardContent, EmptyState, Skeleton } from "@schoolhub/ui";
import { GraduationCap } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import { LoadErrorCard } from "@/components/load-error-card";
import { formatDate } from "@/lib/helpers";
import { queryKeys } from "@/lib/query-client";
import { Services } from "@/services";
import { PARENT_PORTAL_QUERY_MODULE } from "@/services/modules/parent-portal/parent-portal-constant";
import { fetchAllPages } from "@/features/portal/fetch-all-pages";
import { formatDecimal } from "@/features/portal/format-decimal";
import { useSelectedChild } from "@/features/portal/shell/use-selected-child";
import { RESULT_OUTCOME_BADGE, RESULT_OUTCOME_LABEL_KEY } from "./result-outcome";

/** One child's published results, newest first. What the API returns is what is shown: it
 * answers a guardian with published results only, so there is no client-side filter. */
export function PortalResults() {
  const t = useTranslations("portal.results");
  const locale = useLocale();
  const { studentId } = useSelectedChild(undefined);
  const query = useQuery({
    queryKey: queryKeys.list(PARENT_PORTAL_QUERY_MODULE, "results", { studentId }),
    enabled: studentId !== undefined,
    queryFn: () =>
      fetchAllPages((cursor) => Services.results.listResults({ studentId, cursor, pageSize: 100 })),
  });

  function body() {
    if (query.isPending) return <Skeleton className="h-48 w-full" />;
    if (query.isError) {
      return (
        <LoadErrorCard
          message={t("loadError")}
          onRetry={() => {
            void query.refetch();
          }}
        />
      );
    }
    if (query.data.length === 0) {
      return (
        <Card>
          <EmptyState
            icon={GraduationCap}
            title={t("emptyTitle")}
            description={t("emptyDescription")}
          />
        </Card>
      );
    }
    return (
      <ul className="space-y-3">
        {query.data.map((result) => (
          <li key={result.id}>
            <Card>
              <CardContent className="flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-1">
                  <p className="font-medium text-foreground">
                    {result.published_at
                      ? t("published", { date: formatDate(result.published_at, locale) })
                      : t("unpublishedDate")}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {t("marks", {
                      obtained: formatDecimal(locale, result.total_obtained_marks),
                      max: formatDecimal(locale, result.total_max_marks),
                    })}
                    {result.rank_in_section === null
                      ? ""
                      : ` · ${t("rank", { rank: result.rank_in_section })}`}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-lg font-semibold tabular-nums">
                    {formatDecimal(locale, result.percentage, 1)}%
                  </span>
                  {result.grade ? <Badge variant="primary">{result.grade}</Badge> : null}
                  <Badge variant={RESULT_OUTCOME_BADGE[result.outcome]} appearance="light">
                    {t(RESULT_OUTCOME_LABEL_KEY[result.outcome])}
                  </Badge>
                </div>
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <section className="space-y-4">
      <h1 className="font-heading text-xl font-semibold text-foreground">{t("title")}</h1>
      {body()}
    </section>
  );
}
