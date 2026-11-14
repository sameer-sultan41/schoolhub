"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge, Card, CardContent, EmptyState, Skeleton } from "@schoolhub/ui";
import { GraduationCap } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import { LoadErrorCard } from "@/components/load-error-card";
import { formatDate } from "@/lib/helpers";
import { queryKeys } from "@/lib/query-client";
import { Services, type ResultRecord } from "@/services";
import { PARENT_PORTAL_QUERY_MODULE } from "@/services/modules/parent-portal/parent-portal-constant";
import { fetchAllPages } from "@/features/portal/fetch-all-pages";
import { formatDecimal } from "@/features/portal/format-decimal";
import { ChildGate } from "@/features/portal/shell/child-gate";
import { PortalAdmitCards } from "./portal-admit-cards";
import { RESULT_OUTCOME_BADGE, RESULT_OUTCOME_LABEL_KEY } from "./result-outcome";
import { enumBadge, enumLabel } from "@/features/portal/enum-label";

interface TermGroup {
  term: string | null;
  results: ResultRecord[];
}

/** Newest first, then grouped by the exam's term (a session-wide exam has none), groups in the
 * order their newest result appears. */
function groupByTerm(results: readonly ResultRecord[]): TermGroup[] {
  const sorted = [...results].sort((a, b) =>
    (b.published_at ?? "").localeCompare(a.published_at ?? ""),
  );
  const groups = new Map<string, TermGroup>();
  for (const result of sorted) {
    const key = result.term_name ?? "";
    const group = groups.get(key) ?? { term: result.term_name ?? null, results: [] };
    group.results.push(result);
    groups.set(key, group);
  }
  return [...groups.values()];
}

/** One child's admit cards for exams not yet over, then their published results, newest first. What the API returns is what is shown: it
 * answers a guardian with published results only, so there is no client-side filter. */
export function PortalResults() {
  return <ChildGate>{(child) => <ChildResults studentId={child.student.id} />}</ChildGate>;
}

function ChildResults({ studentId }: { studentId: string }) {
  const t = useTranslations("portal.results");
  const locale = useLocale();
  const query = useQuery({
    queryKey: queryKeys.list(PARENT_PORTAL_QUERY_MODULE, "results", { studentId }),
    queryFn: () =>
      fetchAllPages((cursor) => Services.results.listResults({ studentId, cursor, pageSize: 100 })),
  });

  const groups = useMemo(() => groupByTerm(query.data ?? []), [query.data]);

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
      <div className="space-y-5">
        {groups.map((group) => (
          <section key={group.term ?? ""} className="space-y-3">
            {group.term ? (
              <h2 className="font-heading text-base font-semibold text-foreground">{group.term}</h2>
            ) : null}
            <ul className="space-y-3">
              {group.results.map((result) => (
                <li key={result.id}>
                  <Card>
                    <CardContent className="flex flex-wrap items-center justify-between gap-3">
                      <div className="space-y-1">
                        <p className="font-medium text-foreground">{result.exam_name}</p>
                        <p className="text-sm text-muted-foreground">
                          {[
                            result.published_at
                              ? t("published", { date: formatDate(result.published_at, locale) })
                              : null,
                            t("marks", {
                              obtained: formatDecimal(locale, result.total_obtained_marks),
                              max: formatDecimal(locale, result.total_max_marks),
                            }),
                            result.rank_in_section === null
                              ? null
                              : t("rank", { rank: result.rank_in_section }),
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-lg font-semibold tabular-nums">
                          {t("percentage", { value: formatDecimal(locale, result.percentage, 1) })}
                        </span>
                        {result.grade ? <Badge variant="primary">{result.grade}</Badge> : null}
                        <Badge
                          variant={enumBadge(RESULT_OUTCOME_BADGE, result.outcome, "secondary")}
                          appearance="light"
                        >
                          {enumLabel(t, RESULT_OUTCOME_LABEL_KEY, result.outcome)}
                        </Badge>
                      </div>
                    </CardContent>
                  </Card>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    );
  }

  return (
    <section className="space-y-4">
      <h1 className="font-heading text-xl font-semibold text-foreground">{t("title")}</h1>
      <PortalAdmitCards studentId={studentId} />
      {body()}
    </section>
  );
}
