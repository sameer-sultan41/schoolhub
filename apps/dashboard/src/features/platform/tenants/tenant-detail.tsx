"use client";

import { useMemo, type ReactNode } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Card, Skeleton, Tabs, TabsContent } from "@schoolhub/ui";

import { Toolbar, ToolbarActions, ToolbarHeading } from "@/app/(app)/shell/toolbar";
import { LoadErrorCard } from "@/components/load-error-card";
import { ResponsiveTabsList, type ResponsiveTabItem } from "@/components/responsive-tabs-list";
import { Paths } from "@/config/paths";
import { useCurrentUser } from "@/hooks/use-current-user";
import { useUrlParams } from "@/hooks/use-url-params";
import { resolveErrorMessage } from "@/lib/error-message";
import { hasPermission } from "@/lib/permissions";
import { ApiError, Services } from "@/services";
import { PLATFORM_KEYS } from "@/features/platform/platform-permissions";
import { TenantStatusBadge } from "@/features/platform/shared/platform-badges";
import { tenantDetailKey } from "@/features/platform/shared/platform-query-keys";
import { TenantActions } from "./tenant-actions";
import { TenantOverridesTab } from "./overrides/tenant-overrides-tab";
import { TenantOverviewTab } from "./tenant-overview-tab";
import { TenantSubscriptionTab } from "./subscription/tenant-subscription-tab";
import { TenantUsageTab } from "./tenant-usage-tab";

type TenantTab = "overview" | "subscription" | "overrides" | "usage";
const TENANT_TABS: readonly string[] = ["overview", "subscription", "overrides", "usage"];

function isTenantTab(value: string | null): value is TenantTab {
  return value !== null && TENANT_TABS.includes(value);
}

export interface TenantDetailProps {
  tenantId: string;
  /** Extra header actions after the lifecycle ones: the page puts "Impersonate user" here. */
  extraActions?: ReactNode;
}

/**
 * One school's page: its name, subdomain and status, its lifecycle actions, and the Overview,
 * Subscription, Feature overrides and Usage tabs, each shown only to a viewer holding its view
 * key. The tab is in the URL (`?tab=`), so a link opens it.
 */
export function TenantDetail({ tenantId, extraActions }: TenantDetailProps) {
  const t = useTranslations("platform");
  const tErrors = useTranslations("errors");
  const { data: user } = useCurrentUser();
  const { searchParams, setParams } = useUrlParams();

  const query = useQuery({
    queryKey: tenantDetailKey(tenantId),
    queryFn: () => Services.platform.fetchTenant(tenantId),
  });

  const items = useMemo<ResponsiveTabItem[]>(
    () => [
      { value: "overview", label: t("tenants.tabs.overview") },
      ...(hasPermission(user, PLATFORM_KEYS.subscriptionView)
        ? [{ value: "subscription", label: t("tenants.tabs.subscription") }]
        : []),
      ...(hasPermission(user, PLATFORM_KEYS.flagView)
        ? [{ value: "overrides", label: t("tenants.tabs.overrides") }]
        : []),
      { value: "usage", label: t("tenants.tabs.usage") },
    ],
    [t, user],
  );
  // A tab the viewer can't open (or no tab) falls back to the overview.
  const requested = searchParams.get("tab");
  const tab: TenantTab =
    isTenantTab(requested) && items.some((item) => item.value === requested)
      ? requested
      : "overview";

  if (query.isError) {
    const notFound = query.error instanceof ApiError && query.error.isNotFound;
    return notFound ? (
      <Card className="space-y-2 p-6">
        <p className="text-sm">{t("tenants.detail.notFound")}</p>
        <Link
          href={Paths.PLATFORM_TENANTS}
          className="text-sm text-primary underline-offset-4 hover:underline"
        >
          {t("tenants.detail.backToList")}
        </Link>
      </Card>
    ) : (
      <LoadErrorCard
        message={resolveErrorMessage(query.error, tErrors, t("tenants.detail.loadError"))}
        onRetry={() => {
          void query.refetch();
        }}
      />
    );
  }

  const tenant = query.data;
  if (!tenant) {
    return (
      <div className="space-y-4" aria-busy="true">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <Toolbar>
        <ToolbarHeading
          title={tenant.name}
          description={
            <span className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-sm">{tenant.slug}</span>
              <TenantStatusBadge status={tenant.status} asStatus />
            </span>
          }
        />
        <ToolbarActions>
          <TenantActions tenant={tenant}>{extraActions}</TenantActions>
        </ToolbarActions>
      </Toolbar>
      <Tabs
        value={tab}
        onValueChange={(value) => {
          setParams({ tab: value === "overview" ? null : value });
        }}
      >
        <ResponsiveTabsList
          items={items}
          value={tab}
          onValueChange={(value) => {
            setParams({ tab: value === "overview" ? null : value });
          }}
          moreLabel={t("tenants.tabs.more")}
        />
        <TabsContent value="overview">
          <TenantOverviewTab tenant={tenant} />
        </TabsContent>
        <TabsContent value="subscription">
          <TenantSubscriptionTab tenant={tenant} />
        </TabsContent>
        <TabsContent value="overrides">
          <TenantOverridesTab tenant={tenant} />
        </TabsContent>
        <TabsContent value="usage">
          <TenantUsageTab tenant={tenant} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
