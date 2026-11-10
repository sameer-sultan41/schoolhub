"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, Card, CardContent, EmptyState, Skeleton } from "@schoolhub/ui";
import { Download, IdCard } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import { LoadErrorCard } from "@/components/load-error-card";
import { downloadFile, formatDate } from "@/lib/helpers";
import { queryKeys } from "@/lib/query-client";
import { Services, type AdmitCardRecord } from "@/services";
import { admitCardFilename } from "@/services/modules/admit-cards/admit-cards-helper";
import { PARENT_PORTAL_QUERY_MODULE } from "@/services/modules/parent-portal/parent-portal-constant";
import { fetchAllPages } from "@/features/portal/fetch-all-pages";

/** A child's issued admit cards for exams not yet over, each with its PDF. The server picks the
 * cards (`status=issued`, `current=true`, the guardian's own children only); nothing is filtered
 * here. */
export function PortalAdmitCards({ studentId }: { studentId: string }) {
  const t = useTranslations("portal.admitCards");
  const query = useQuery({
    queryKey: queryKeys.list(PARENT_PORTAL_QUERY_MODULE, "admit-cards", { studentId }),
    queryFn: () =>
      fetchAllPages((cursor) =>
        Services.admitCards.fetchCurrentAdmitCardsPage({ studentId, cursor, pageSize: 50 }),
      ),
  });

  function body() {
    if (query.isPending) return <Skeleton className="h-20 w-full" />;
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
          <EmptyState icon={IdCard} title={t("emptyTitle")} description={t("emptyDescription")} />
        </Card>
      );
    }
    return (
      <ul className="space-y-3" aria-label={t("title")}>
        {query.data.map((card) => (
          <li key={card.id}>
            <AdmitCardRow card={card} />
          </li>
        ))}
      </ul>
    );
  }

  return (
    <section className="space-y-3">
      <h2 className="font-heading text-base font-semibold text-foreground">{t("title")}</h2>
      {body()}
    </section>
  );
}

function AdmitCardRow({ card }: { card: AdmitCardRecord }) {
  const t = useTranslations("portal.admitCards");
  const locale = useLocale();
  const [state, setState] = useState<"idle" | "busy" | "error">("idle");

  // A signed link, fetched on click: it expires, so it is never held in the list.
  async function download() {
    setState("busy");
    try {
      downloadFile(
        await Services.admitCards.fetchAdmitCardDownloadUrl(card.id),
        admitCardFilename(card),
      );
      setState("idle");
    } catch {
      setState("error");
    }
  }

  const dates =
    card.exam_starts_on && card.exam_ends_on
      ? t("dates", {
          start: formatDate(card.exam_starts_on, locale),
          end: formatDate(card.exam_ends_on, locale),
        })
      : null;

  return (
    <Card>
      <CardContent className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <p className="font-medium text-foreground">{card.exam_name}</p>
          <p className="text-sm text-muted-foreground">
            {[dates, t("number", { number: card.admit_card_no })].filter(Boolean).join(" · ")}
          </p>
        </div>
        <span className="inline-flex flex-col items-start gap-1">
          <Button
            variant="outline"
            size="sm"
            disabled={state === "busy"}
            onClick={() => {
              void download();
            }}
          >
            <Download aria-hidden="true" />
            {t("download", { exam: card.exam_name })}
          </Button>
          {state === "error" ? (
            <span role="alert" className="text-xs text-destructive">
              {t("downloadFailed")}
            </span>
          ) : null}
        </span>
      </CardContent>
    </Card>
  );
}
