"use client";

import { useTranslations } from "next-intl";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardHeading,
  CardTitle,
  Skeleton,
} from "@schoolhub/ui";

import { Toolbar, ToolbarHeading } from "@/app/(app)/shell/toolbar";
import { LoadErrorCard } from "@/components/load-error-card";
import { resolveErrorMessage } from "@/lib/error-message";
import { formatLastUpdated } from "@/lib/helpers";
import { WEBSITE_CONTENT_STATUSES } from "@/services/shared/website-content";
import { ContentStatusBadge } from "@/features/website/shared/content-status-badge";
import { INVENTORY_KINDS, STALE_AFTER_DAYS, type InventoryKind } from "./inventory-constants";
import { useStaleContent, useStatusCounts } from "./use-content-inventory";

/** One kind's card: a count per status, a skeleton while they load, Retry when they fail. */
function KindCounts({ kind }: { kind: InventoryKind }) {
  const t = useTranslations("website");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const { counts, isError, error, refetch } = useStatusCounts(kind);

  return (
    <Card>
      <CardHeader>
        <CardHeading>
          <CardTitle>{t(`inventory.kinds.${kind}`)}</CardTitle>
        </CardHeading>
      </CardHeader>
      <CardContent>
        {isError ? (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              {resolveErrorMessage(error, tErrors, t("inventory.unavailable"))}
            </p>
            <Button variant="outline" size="sm" onClick={refetch}>
              {tCommon("retry")}
            </Button>
          </div>
        ) : (
          <dl className="grid grid-cols-3 gap-2">
            {WEBSITE_CONTENT_STATUSES.map((status) => (
              <div key={status} className="space-y-1">
                <dt className="text-xs text-muted-foreground">{t(`status.${status}`)}</dt>
                <dd className="text-lg font-semibold tabular-nums">
                  {counts ? counts[status].toLocaleString() : <Skeleton className="h-6 w-8" />}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </CardContent>
    </Card>
  );
}

/** Content not updated in more than `STALE_AFTER_DAYS`, oldest first, across every kind. */
function StaleContent() {
  const t = useTranslations("website");
  const tErrors = useTranslations("errors");
  const { items, hasMore, isPending, isError, error, refetch } = useStaleContent();

  if (isError) {
    return (
      <LoadErrorCard
        message={resolveErrorMessage(error, tErrors, t("inventory.stale.unavailable"))}
        onRetry={refetch}
      />
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardHeading>
          <CardTitle>{t("inventory.stale.title")}</CardTitle>
          <p className="text-sm text-muted-foreground">
            {t("inventory.stale.description", { days: STALE_AFTER_DAYS })}
          </p>
        </CardHeading>
      </CardHeader>
      <CardContent>
        {isPending ? (
          <Skeleton className="h-16 w-full" />
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("inventory.stale.empty")}</p>
        ) : (
          <ul className="divide-y divide-border">
            {items.map((item) => (
              <li
                key={`${item.kind}:${item.id}`}
                className="flex flex-wrap items-center gap-3 py-2"
              >
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{item.title}</span>
                <span className="text-xs text-muted-foreground">
                  {t(`inventory.kinds.${item.kind}`)}
                </span>
                <ContentStatusBadge status={item.status} />
                <span className="text-xs text-muted-foreground">
                  {t("inventory.stale.lastUpdated", { when: formatLastUpdated(item.updated_at) })}
                </span>
              </li>
            ))}
          </ul>
        )}
        {hasMore ? (
          <p className="pt-2 text-xs text-muted-foreground">{t("inventory.stale.more")}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}

/** The content inventory (module doc §13): each kind by status, and what has gone stale. */
export function ContentInventory() {
  const t = useTranslations("website");
  return (
    <>
      <Toolbar>
        <ToolbarHeading title={t("inventory.title")} description={t("inventory.summary")} />
      </Toolbar>
      <div className="space-y-5">
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
          {INVENTORY_KINDS.map((kind) => (
            <KindCounts key={kind} kind={kind} />
          ))}
        </div>
        <StaleContent />
      </div>
    </>
  );
}
