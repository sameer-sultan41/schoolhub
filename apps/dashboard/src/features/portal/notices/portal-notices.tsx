"use client";

import Link from "next/link";
import { Badge, Button, Card, CardContent, EmptyState, Skeleton } from "@schoolhub/ui";
import { Megaphone } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import { LoadErrorCard } from "@/components/load-error-card";
import { Paths } from "@/config/paths";
import { useCursorList } from "@/hooks/use-cursor-list";
import { resolveErrorMessage } from "@/lib/error-message";
import { formatDate } from "@/lib/helpers";
import { queryKeys } from "@/lib/query-client";
import { Services, type NoticeRead } from "@/services";
import { NOTICES_QUERY_MODULE } from "@/services/modules/notices/notices-constant";
import { isPortalNotice } from "@/services/modules/notices/notices-helper";
import { NOTICE_TYPE_BADGE, NOTICE_TYPE_LABEL_KEY } from "./notice-type";
import { enumBadge, enumLabel } from "@/lib/enum-label";

const NOTICES_PAGE_SIZE = 20;

/** `/portal/notices`: the school's published notices, newest first, paged by cursor. */
export function PortalNotices() {
  const t = useTranslations("portal.notices");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const locale = useLocale();

  const { query, rows, stack, nextCursor, retry } = useCursorList<NoticeRead>({
    resetKey: "all",
    queryKey: (cursor) => queryKeys.list(NOTICES_QUERY_MODULE, "portal", { cursor }),
    queryFn: (cursor) => Services.notices.listNotices({ cursor, pageSize: NOTICES_PAGE_SIZE }),
  });
  // A guardian is answered the portal shape; the guard narrows the generated union.
  const notices = rows.filter(isPortalNotice);

  return (
    <section className="space-y-4">
      <h1 className="font-heading text-xl font-semibold text-foreground">{t("title")}</h1>
      {query.isPending && <Skeleton className="h-32 w-full" />}
      {query.isError && !query.data && (
        <LoadErrorCard
          message={resolveErrorMessage(query.error, tErrors, t("loadError"))}
          onRetry={retry}
        />
      )}
      {query.data && notices.length === 0 && (
        <EmptyState icon={Megaphone} title={t("emptyTitle")} description={t("emptyDescription")} />
      )}
      {notices.length > 0 && (
        <ul className="space-y-3">
          {notices.map((notice) => (
            <li key={notice.id}>
              <Card>
                <CardContent className="flex flex-col gap-2 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={Paths.PORTAL_NOTICE(notice.id)}
                      className="text-sm font-medium text-foreground hover:underline"
                    >
                      {notice.title}
                    </Link>
                    <Badge
                      variant={enumBadge(NOTICE_TYPE_BADGE, notice.notice_type, "secondary")}
                      appearance="light"
                      size="sm"
                    >
                      {enumLabel(t, NOTICE_TYPE_LABEL_KEY, notice.notice_type)}
                    </Badge>
                    {notice.requires_acknowledgment && notice.acknowledged_at === null && (
                      <Badge variant="warning" appearance="light" size="sm">
                        {t("needsAcknowledgment")}
                      </Badge>
                    )}
                  </div>
                  {notice.published_at && (
                    <p className="text-xs text-muted-foreground">
                      {t("publishedOn", { date: formatDate(notice.published_at, locale) })}
                    </p>
                  )}
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
      {(stack.hasPrevious || nextCursor) && (
        <div className="flex justify-between gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={!stack.hasPrevious}
            onClick={stack.goPrevious}
          >
            {tCommon("previous")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!nextCursor}
            onClick={() => {
              if (nextCursor) stack.goNext(nextCursor);
            }}
          >
            {tCommon("next")}
          </Button>
        </div>
      )}
    </section>
  );
}
