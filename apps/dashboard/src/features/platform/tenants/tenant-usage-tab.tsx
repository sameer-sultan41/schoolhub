"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { Alert, AlertDescription, Button, Card, CardContent, Skeleton } from "@schoolhub/ui";
import { RefreshCw } from "lucide-react";

import { LoadErrorCard } from "@/components/load-error-card";
import { EMPTY_VALUE } from "@/lib/constants";
import { resolveErrorMessage } from "@/lib/error-message";
import { formatLastUpdated } from "@/lib/helpers";
import { queryKeys } from "@/lib/query-client";
import { Services, type TenantRecord, type TenantUsage } from "@/services";
import { PLATFORM_QUERY_MODULE } from "@/services/modules/platform/platform-constant";
import { bytesToGib } from "@/services/modules/platform/platform-helper";

/** The three quotas v1 enforces (platform-admin.md §11); the others are recorded, not counted. */
const COUNTED = ["students", "staff", "storage_gb"] as const;

function usageKey(tenantId: string) {
  return queryKeys.detail(PLATFORM_QUERY_MODULE, "usage", tenantId);
}

/**
 * A school's latest usage snapshot against its effective limits. Snapshots are nightly; Refresh
 * takes one now (`:refresh-usage`), which whoever may read usage may do: it only appends a
 * metrics row.
 */
export function TenantUsageTab({ tenant }: { tenant: TenantRecord }) {
  const t = useTranslations("platform.usage");
  const tErrors = useTranslations("errors");
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: usageKey(tenant.id),
    queryFn: () => Services.platform.fetchTenantUsage(tenant.id),
  });
  const refresh = useMutation({
    mutationFn: () => Services.platform.refreshTenantUsage(tenant.id),
    onSuccess: (usage: TenantUsage) => {
      queryClient.setQueryData(usageKey(tenant.id), usage);
    },
  });

  if (query.isError) {
    return (
      <LoadErrorCard
        message={resolveErrorMessage(query.error, tErrors, t("loadError"))}
        onRetry={() => {
          void query.refetch();
        }}
      />
    );
  }

  const usage = query.data;
  const snapshot = usage?.snapshot ?? null;
  const used = (metric: (typeof COUNTED)[number]): number | null => {
    if (!snapshot) return null;
    if (metric === "storage_gb") return bytesToGib(snapshot.storage_bytes);
    return snapshot[metric];
  };
  const limitText = (limit: number | null | undefined) =>
    limit === null || limit === undefined ? t("unlimited") : limit.toLocaleString(locale);

  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground">
            {snapshot
              ? t("takenAt", { when: formatLastUpdated(snapshot.taken_at) })
              : usage
                ? t("noSnapshot")
                : null}
          </p>
          <Button
            variant="outline"
            isLoading={refresh.isPending}
            loadingLabel={t("refreshing")}
            onClick={() => {
              refresh.mutate();
            }}
          >
            <RefreshCw aria-hidden="true" />
            {t("refresh")}
          </Button>
        </div>
        {refresh.isError && (
          <Alert variant="destructive">
            <AlertDescription>
              {resolveErrorMessage(refresh.error, tErrors, tCommon("submitFailed"))}
            </AlertDescription>
          </Alert>
        )}
        <dl className="grid gap-3 sm:grid-cols-3">
          {COUNTED.map((metric) => (
            <div key={metric} className="rounded-md border border-border p-3">
              <dt className="text-sm text-muted-foreground">{t(`metrics.${metric}`)}</dt>
              <dd className="mt-1 text-lg font-semibold">
                {usage ? (
                  t("usedOf", {
                    used: used(metric)?.toLocaleString(locale) ?? EMPTY_VALUE,
                    limit: limitText(usage.limits[metric]),
                  })
                ) : (
                  <Skeleton className="h-6 w-24" />
                )}
              </dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}
