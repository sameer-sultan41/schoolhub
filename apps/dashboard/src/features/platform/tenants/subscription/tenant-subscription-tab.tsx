"use client";

import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { Button, Card, CardContent, Skeleton } from "@schoolhub/ui";

import { LoadErrorCard } from "@/components/load-error-card";
import { useCurrentUser } from "@/hooks/use-current-user";
import { EMPTY_VALUE } from "@/lib/constants";
import { resolveErrorMessage } from "@/lib/error-message";
import { formatMoney } from "@/lib/format-decimal";
import { formatDate } from "@/lib/helpers";
import { hasPermission } from "@/lib/permissions";
import { queryKeys } from "@/lib/query-client";
import { Services, type SubscriptionState, type TenantRecord } from "@/services";
import { PLATFORM_QUERY_MODULE } from "@/services/modules/platform/platform-constant";
import { PLATFORM_KEYS } from "@/features/platform/platform-permissions";
import { SubscriptionStatusBadge } from "@/features/platform/shared/platform-badges";
import {
  ActivateSubscriptionDialog,
  ChangePlanDialog,
  MarkPaymentFailedDialog,
  RecordPaymentDialog,
} from "./subscription-dialogs";

type SubscriptionDialog = "activate" | "recordPayment" | "markFailed" | "changePlan";

/** Which actions the subscription's state allows (`apps/api/apps/platform_admin/subscriptions`);
 * the server refuses any other with 409 `invalid_transition` or `no_live_subscription`. */
function allowedActions(state: SubscriptionState): SubscriptionDialog[] {
  const status = state.subscription?.status;
  if (status === undefined || status === "canceled") return ["activate"];
  if (status === "trialing") return ["activate", "changePlan"];
  if (status === "active") return ["recordPayment", "markFailed", "changePlan"];
  return ["recordPayment", "changePlan"];
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 py-2 sm:grid-cols-3">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-sm sm:col-span-2">{children}</dd>
    </div>
  );
}

/** A school's billing state, with the manual billing actions its state allows. */
export function TenantSubscriptionTab({ tenant }: { tenant: TenantRecord }) {
  const t = useTranslations("platform.subscription");
  const tErrors = useTranslations("errors");
  const locale = useLocale();
  const { data: user } = useCurrentUser();
  const canUpdate = hasPermission(user, PLATFORM_KEYS.subscriptionUpdate);
  const [dialog, setDialog] = useState<SubscriptionDialog | null>(null);

  const query = useQuery({
    queryKey: queryKeys.detail(PLATFORM_QUERY_MODULE, "subscription", tenant.id),
    queryFn: () => Services.platform.fetchSubscription(tenant.id),
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
  const state = query.data;
  if (!state) return <Skeleton className="h-48 w-full" />;

  const sub = state.subscription;
  const close = (open: boolean) => {
    if (!open) setDialog(null);
  };

  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        {sub ? (
          <dl className="divide-y divide-border">
            <Row label={t("status")}>
              <SubscriptionStatusBadge status={sub.status} />
            </Row>
            <Row label={t("plan")}>
              {t("planLine", {
                name: sub.plan.name,
                code: sub.plan.code,
                amount: formatMoney(locale, sub.plan.price_amount),
                currency: sub.plan.currency,
              })}
            </Row>
            <Row label={t("period")}>
              {t("periodLine", {
                start: formatDate(sub.current_period_start, locale),
                end: formatDate(sub.current_period_end, locale),
              })}
            </Row>
            <Row label={t("provider")}>
              {[sub.billing_provider, sub.billing_provider_ref].filter(Boolean).join(" · ") ||
                EMPTY_VALUE}
            </Row>
          </dl>
        ) : (
          <p className="text-sm text-muted-foreground">
            {state.trial_ends_at
              ? t("noSubscriptionTrial", { date: formatDate(state.trial_ends_at, locale) })
              : t("noSubscription")}
          </p>
        )}
        {canUpdate && (
          <div className="flex flex-wrap gap-2">
            {allowedActions(state).map((action) => (
              <Button
                key={action}
                variant={action === "markFailed" ? "outline" : "primary"}
                onClick={() => {
                  setDialog(action);
                }}
              >
                {t(`${action}.action`)}
              </Button>
            ))}
          </div>
        )}
      </CardContent>
      {dialog === "activate" && (
        <ActivateSubscriptionDialog tenant={tenant} state={state} onOpenChange={close} />
      )}
      {dialog === "recordPayment" && <RecordPaymentDialog tenant={tenant} onOpenChange={close} />}
      {dialog === "markFailed" && <MarkPaymentFailedDialog tenant={tenant} onOpenChange={close} />}
      {dialog === "changePlan" && (
        <ChangePlanDialog tenant={tenant} state={state} onOpenChange={close} />
      )}
    </Card>
  );
}
