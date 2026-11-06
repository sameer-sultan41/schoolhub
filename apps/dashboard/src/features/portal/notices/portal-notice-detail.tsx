"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Alert, Badge, Button, Card, CardContent, EmptyState, Skeleton } from "@schoolhub/ui";
import { MegaphoneOff } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import { LoadErrorCard } from "@/components/load-error-card";
import { Paths } from "@/config/paths";
import { useInvalidateModule } from "@/hooks/use-invalidate-module";
import { resolveErrorMessage } from "@/lib/error-message";
import { formatDate } from "@/lib/helpers";
import { queryKeys } from "@/lib/query-client";
import { ApiError, Services } from "@/services";
import { NOTICES_QUERY_MODULE } from "@/services/modules/notices/notices-constant";
import { isPortalNotice } from "@/services/modules/notices/notices-helper";
import { NOTICE_TYPE_BADGE, NOTICE_TYPE_LABEL_KEY } from "./notice-type";
import { enumBadge, enumLabel } from "@/features/portal/enum-label";

/** One notice, with Acknowledge when it asks for one and the viewer has not given it yet. */
export function PortalNoticeDetail({ noticeId }: { noticeId: string }) {
  const t = useTranslations("portal.notices");
  const tErrors = useTranslations("errors");
  const locale = useLocale();
  const invalidate = useInvalidateModule(NOTICES_QUERY_MODULE);
  const [justAcknowledged, setJustAcknowledged] = useState(false);

  const query = useQuery({
    queryKey: queryKeys.detail(NOTICES_QUERY_MODULE, "portal", noticeId),
    queryFn: () => Services.notices.fetchNotice(noticeId),
  });
  const acknowledge = useMutation({
    mutationFn: () => Services.notices.acknowledgeNotice(noticeId),
    onSuccess: () => {
      setJustAcknowledged(true);
      invalidate();
    },
  });

  if (query.isPending) return <Skeleton className="h-40 w-full" />;
  if (query.isError) {
    if (query.error instanceof ApiError && query.error.isNotFound) {
      return (
        <EmptyState
          icon={MegaphoneOff}
          title={t("notFoundTitle")}
          description={t("notFoundDescription")}
        />
      );
    }
    return (
      <LoadErrorCard
        message={resolveErrorMessage(query.error, tErrors, t("loadError"))}
        onRetry={() => {
          void query.refetch();
        }}
      />
    );
  }
  const notice = query.data;
  if (!isPortalNotice(notice)) {
    return (
      <EmptyState
        icon={MegaphoneOff}
        title={t("notFoundTitle")}
        description={t("notFoundDescription")}
      />
    );
  }

  const isAcknowledged = notice.acknowledged_at !== null || justAcknowledged;
  const canAcknowledge = notice.requires_acknowledgment && !isAcknowledged;

  return (
    <article className="space-y-4">
      <Link href={Paths.PORTAL_NOTICES} className="text-sm text-muted-foreground hover:underline">
        {t("back")}
      </Link>
      <Card>
        <CardContent className="space-y-3 p-5">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-heading text-xl font-semibold text-foreground">{notice.title}</h1>
            <Badge
              variant={enumBadge(NOTICE_TYPE_BADGE, notice.notice_type, "secondary")}
              appearance="light"
              size="sm"
            >
              {enumLabel(t, NOTICE_TYPE_LABEL_KEY, notice.notice_type)}
            </Badge>
          </div>
          {notice.published_at && (
            <p className="text-xs text-muted-foreground">
              {t("publishedOn", { date: formatDate(notice.published_at, locale) })}
            </p>
          )}
          <p className="text-sm whitespace-pre-wrap text-foreground">{notice.body}</p>
        </CardContent>
      </Card>
      {acknowledge.isError && (
        <Alert variant="destructive">
          {resolveErrorMessage(acknowledge.error, tErrors, t("acknowledgeFailed"))}
        </Alert>
      )}
      {canAcknowledge && (
        <Button
          isLoading={acknowledge.isPending}
          loadingLabel={t("acknowledging")}
          onClick={() => {
            acknowledge.mutate();
          }}
        >
          {t("acknowledge")}
        </Button>
      )}
      {notice.requires_acknowledgment && isAcknowledged && (
        <Badge variant="success" appearance="light">
          {t("acknowledged")}
        </Badge>
      )}
    </article>
  );
}
