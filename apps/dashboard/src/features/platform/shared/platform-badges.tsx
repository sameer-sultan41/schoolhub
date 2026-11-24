"use client";

import { useTranslations } from "next-intl";
import { Badge } from "@schoolhub/ui";

import { enumBadge, enumLabel } from "@/lib/enum-label";
import type { SubscriptionStatus, TenantStatus } from "@/services";

type BadgeVariant = "primary" | "secondary" | "success" | "warning" | "info" | "destructive";

const TENANT_STATUS_LABELS: Record<TenantStatus, string> = {
  provisioning: "status.provisioning",
  trial: "status.trial",
  active: "status.active",
  past_due: "status.past_due",
  suspended: "status.suspended",
  deprovisioned: "status.deprovisioned",
};

const TENANT_STATUS_VARIANTS: Record<TenantStatus, BadgeVariant> = {
  provisioning: "secondary",
  trial: "info",
  active: "success",
  past_due: "warning",
  suspended: "destructive",
  deprovisioned: "secondary",
};

const SUBSCRIPTION_STATUS_LABELS: Record<SubscriptionStatus, string> = {
  trialing: "subscriptionStatus.trialing",
  active: "subscriptionStatus.active",
  past_due: "subscriptionStatus.past_due",
  canceled: "subscriptionStatus.canceled",
};

const SUBSCRIPTION_STATUS_VARIANTS: Record<SubscriptionStatus, BadgeVariant> = {
  trialing: "info",
  active: "success",
  past_due: "warning",
  canceled: "secondary",
};

/** A school's lifecycle status, by its exhaustive maps; a status the maps don't know yet reads
 * humanised, never as a raw key (L32). */
export function TenantStatusBadge({
  status,
  asStatus = false,
}: {
  status: TenantStatus;
  /** The detail page's header badge: a named live region, so a lifecycle move is announced. */
  asStatus?: boolean;
}) {
  const t = useTranslations("platform");
  return (
    <Badge
      variant={enumBadge(TENANT_STATUS_VARIANTS, status, "secondary")}
      appearance="light"
      {...(asStatus ? { role: "status", "aria-label": t("tenants.statusLabel") } : {})}
    >
      {enumLabel(t, TENANT_STATUS_LABELS, status)}
    </Badge>
  );
}

export function SubscriptionStatusBadge({ status }: { status: SubscriptionStatus }) {
  const t = useTranslations("platform");
  return (
    <Badge
      variant={enumBadge(SUBSCRIPTION_STATUS_VARIANTS, status, "secondary")}
      appearance="light"
    >
      {enumLabel(t, SUBSCRIPTION_STATUS_LABELS, status)}
    </Badge>
  );
}

/** A tenant status's label, for a filter's options. */
export function useTenantStatusLabel() {
  const t = useTranslations("platform");
  return (status: TenantStatus) => enumLabel(t, TENANT_STATUS_LABELS, status);
}
