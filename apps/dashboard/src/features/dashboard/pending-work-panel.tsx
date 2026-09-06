"use client";

import { fetchPage } from "@schoolhub/api-client";
import { Card, CardContent, CardHeader, CardTitle, EmptyState, Skeleton } from "@schoolhub/ui";
import { useQuery } from "@tanstack/react-query";
import { Inbox } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { ApiErrorAlert } from "@/components/api-error-alert";
import type { PromotionBatchRecord } from "@/features/academics/academics-types";
import { PENDING_PREVIEW_SIZE } from "@/features/dashboard/dashboard-constants";
import type { SubstitutionRecord } from "@/features/timetable/timetable-types";
import { useSession } from "@/hooks/use-session";
import { apiClient } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { hasPermission } from "@/lib/permissions";
import { queryKeys } from "@/lib/query-client";

/**
 * The queues a reader is expected to act on, previewed.
 *
 * Deliberately a preview and not a second copy of two list screens: a few rows and a way
 * through to the real thing. Each half is gated on the key that lets the reader *do*
 * something about it, not merely read it — a substitution list is only work if you can
 * approve it.
 */
export function PendingWorkPanel() {
  const t = useTranslations("dashboard");
  const locale = useLocale();
  const { user } = useSession();

  // `GET /teacher-substitutions` itself reads under `timetable.timetable.view`; approving
  // is the separate key, and it is the one that makes a proposed cover *work* rather
  // than trivia. `SUBSTITUTION_APPROVERS` is vice_principal/principal.
  const canApproveSubstitutions = hasPermission(user, "timetable.substitution.approve");
  const canViewPromotions = hasPermission(user, "academics.promotion.view");

  const substitutions = useQuery({
    queryKey: queryKeys.list("timetable", "teacher-substitutions", {
      status: "proposed",
      scope: "pending",
    }),
    queryFn: () =>
      fetchPage<SubstitutionRecord>(apiClient, "/teacher-substitutions", {
        query: { status: "proposed", page_size: PENDING_PREVIEW_SIZE },
      }),
    enabled: canApproveSubstitutions,
  });

  const promotions = useQuery({
    queryKey: queryKeys.list("academics", "student-promotions", {
      status: "pending_approval",
      scope: "pending",
    }),
    queryFn: () =>
      fetchPage<PromotionBatchRecord>(apiClient, "/student-promotions", {
        query: { status: "pending_approval", page_size: PENDING_PREVIEW_SIZE },
      }),
    enabled: canViewPromotions,
  });

  if (!canApproveSubstitutions && !canViewPromotions) return null;

  const substitutionRows = substitutions.data?.items ?? [];
  const promotionRows = promotions.data?.items ?? [];
  const error = substitutions.error ?? promotions.error;
  const isPending =
    (canApproveSubstitutions && substitutions.isPending) ||
    (canViewPromotions && promotions.isPending);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("pending.title")}</CardTitle>
      </CardHeader>

      <CardContent className="space-y-6">
        {error ? (
          <ApiErrorAlert error={error} />
        ) : isPending ? (
          <div aria-busy="true" className="space-y-3">
            {Array.from({ length: 3 }, (_, index) => (
              <Skeleton key={`pending-${String(index)}`} className="h-12 w-full" />
            ))}
          </div>
        ) : substitutionRows.length === 0 && promotionRows.length === 0 ? (
          <EmptyState
            icon={Inbox}
            title={t("pending.emptyTitle")}
            description={t("pending.emptyDescription")}
          />
        ) : (
          <>
            {substitutionRows.length > 0 ? (
              <section className="space-y-2">
                <h3 className="text-sm font-medium text-foreground">
                  {t("pending.substitutions")}
                </h3>
                <ul className="space-y-1">
                  {substitutionRows.map((row) => (
                    <li key={row.id}>
                      <Link
                        href="/timetable/substitutions"
                        className="block rounded-[var(--sh-radius)] px-3 py-2 text-sm transition-colors hover:bg-muted"
                      >
                        <span className="block font-medium text-foreground">
                          {t("pending.substitutionOn", { date: formatDate(row.date, locale) })}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          {row.reason ?? t("pending.noReason")}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
                <Link
                  href="/timetable/substitutions"
                  className="inline-block text-xs font-medium text-primary underline-offset-4 hover:underline"
                >
                  {t("pending.allSubstitutions")}
                </Link>
              </section>
            ) : null}

            {promotionRows.length > 0 ? (
              <section className="space-y-2">
                <h3 className="text-sm font-medium text-foreground">{t("pending.promotions")}</h3>
                <ul className="space-y-1">
                  {promotionRows.map((row) => (
                    <li key={row.batch_id}>
                      {/* Every `{id}` on this prefix is a batch id — the review screen
                          resolves it straight from the URL. */}
                      <Link
                        href={`/academics/promotions/${row.batch_id}`}
                        className="block rounded-[var(--sh-radius)] px-3 py-2 text-sm transition-colors hover:bg-muted"
                      >
                        <span className="block font-medium text-foreground">
                          {t("pending.promotionStudents", { count: row.students })}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          {formatDate(row.started_at, locale)}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
                <Link
                  href="/academics/promotions"
                  className="inline-block text-xs font-medium text-primary underline-offset-4 hover:underline"
                >
                  {t("pending.allPromotions")}
                </Link>
              </section>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}
