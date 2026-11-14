"use client";

import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Alert, Badge, Button, Card, CardContent, EmptyState, Skeleton } from "@schoolhub/ui";
import { Bell } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import { FilterSelect } from "@/components/filter-select";
import { LoadErrorCard } from "@/components/load-error-card";
import { useCursorList } from "@/hooks/use-cursor-list";
import { useInvalidateModule } from "@/hooks/use-invalidate-module";
import { resolveErrorMessage } from "@/lib/error-message";
import { Services, type NotificationRecord } from "@/services";
import { NOTIFICATIONS_QUERY_MODULE } from "@/services/modules/notifications/notifications-constant";
import {
  NOTIFICATION_CATEGORY_LABEL_KEY,
  NOTIFICATION_PRIORITY_BADGE,
  NOTIFICATION_PRIORITY_LABEL_KEY,
} from "./notification-labels";
import { inboxListKey } from "./notification-query-keys";
import { useMarkNotificationRead } from "./use-mark-notification-read";
import { enumBadge, enumLabel } from "@/lib/enum-label";

const INBOX_PAGE_SIZE = 20;
type ReadFilter = "" | "unread" | "read";
const READ_PARAM: Record<ReadFilter, boolean | undefined> = {
  "": undefined,
  unread: false,
  read: true,
};

/** The newest `created_at` among the rows, as sent: what "mark all read" covers. */
function newestCreatedAt(rows: readonly NotificationRecord[]): string | undefined {
  let newest: NotificationRecord | undefined;
  for (const row of rows) {
    if (newest === undefined || Date.parse(row.created_at) > Date.parse(newest.created_at)) {
      newest = row;
    }
  }
  return newest?.created_at;
}

/** `/portal/notifications`: the viewer's own inbox, newest first, paged by cursor. Opening an
 * item marks it read; Mark all read covers what is on screen, not what arrived after. */
export function PortalNotifications() {
  const t = useTranslations("portal.notifications");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const locale = useLocale();
  const invalidate = useInvalidateModule(NOTIFICATIONS_QUERY_MODULE);
  const [filter, setFilter] = useState<ReadFilter>("");
  const [openId, setOpenId] = useState<string | null>(null);
  const { markRead, isError: markReadFailed } = useMarkNotificationRead();

  const { query, rows, stack, nextCursor, retry } = useCursorList<NotificationRecord>({
    resetKey: filter,
    queryKey: (cursor) => inboxListKey({ filter, cursor }),
    queryFn: (cursor) =>
      Services.notifications.listNotifications({
        read: READ_PARAM[filter],
        cursor,
        pageSize: INBOX_PAGE_SIZE,
      }),
  });

  const markAll = useMutation({
    mutationFn: (before: string | undefined) =>
      Services.notifications.markAllNotificationsRead(before),
    onSuccess: invalidate,
  });
  const newest = newestCreatedAt(rows);
  const hasUnread = rows.some((row) => row.read_at === null);
  const formatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }),
    [locale],
  );

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-heading text-xl font-semibold text-foreground">{t("title")}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <FilterSelect
            label={t("filter.label")}
            allLabel={t("filter.all")}
            value={filter}
            onChange={(value) => {
              setFilter(value === "unread" || value === "read" ? value : "");
              setOpenId(null);
            }}
            options={[
              { id: "unread", name: t("filter.unread") },
              { id: "read", name: t("filter.read") },
            ]}
          />
          <Button
            variant="outline"
            disabled={!hasUnread}
            isLoading={markAll.isPending}
            loadingLabel={t("markingAll")}
            onClick={() => {
              markAll.mutate(newest);
            }}
          >
            {t("markAllRead")}
          </Button>
        </div>
      </div>
      {markAll.isError && (
        <Alert variant="destructive">
          {resolveErrorMessage(markAll.error, tErrors, t("markAllFailed"))}
        </Alert>
      )}
      {markReadFailed && <Alert variant="destructive">{t("markReadFailed")}</Alert>}
      {query.isPending && <Skeleton className="h-32 w-full" />}
      {query.isError && !query.data && (
        <LoadErrorCard
          message={resolveErrorMessage(query.error, tErrors, t("loadError"))}
          onRetry={retry}
        />
      )}
      {query.data && rows.length === 0 && (
        <EmptyState icon={Bell} title={t("emptyTitle")} description={t("emptyDescription")} />
      )}
      {rows.length > 0 && (
        <ul className="space-y-2">
          {rows.map((notification) => {
            const isOpen = openId === notification.id;
            return (
              <li key={notification.id}>
                <Card>
                  <CardContent className="p-0">
                    <button
                      type="button"
                      aria-expanded={isOpen}
                      className="flex w-full flex-col gap-1 p-4 text-start"
                      onClick={() => {
                        setOpenId(isOpen ? null : notification.id);
                        if (!isOpen) markRead(notification);
                      }}
                    >
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-foreground">
                          {notification.title}
                        </span>
                        {notification.read_at === null && (
                          <Badge variant="primary" size="sm">
                            {t("unreadBadge")}
                          </Badge>
                        )}
                        <Badge variant="secondary" appearance="light" size="sm">
                          {enumLabel(t, NOTIFICATION_CATEGORY_LABEL_KEY, notification.category)}
                        </Badge>
                        {notification.priority !== "normal" && (
                          <Badge
                            variant={enumBadge(
                              NOTIFICATION_PRIORITY_BADGE,
                              notification.priority,
                              "secondary",
                            )}
                            appearance="light"
                            size="sm"
                          >
                            {enumLabel(t, NOTIFICATION_PRIORITY_LABEL_KEY, notification.priority)}
                          </Badge>
                        )}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {formatter.format(new Date(notification.created_at))}
                      </span>
                    </button>
                    {isOpen && (
                      <p className="border-t border-border p-4 text-sm whitespace-pre-wrap text-foreground">
                        {notification.body}
                      </p>
                    )}
                  </CardContent>
                </Card>
              </li>
            );
          })}
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
