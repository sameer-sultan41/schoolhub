"use client";

import type { ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Card, CardContent } from "@schoolhub/ui";

import { EMPTY_VALUE } from "@/lib/constants";
import { formatDate } from "@/lib/helpers";
import type { TenantRecord } from "@/services";

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 py-2 sm:grid-cols-3">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-sm sm:col-span-2">{children}</dd>
    </div>
  );
}

/** A school's contact, regional settings and lifecycle dates. Editing is the header's Edit. */
export function TenantOverviewTab({ tenant }: { tenant: TenantRecord }) {
  const t = useTranslations("platform.tenants.overview");
  const locale = useLocale();
  const date = (value: string | null) => (value ? formatDate(value, locale) : EMPTY_VALUE);

  return (
    <Card>
      <CardContent className="p-5">
        <dl className="divide-y divide-border">
          <Row label={t("contactName")}>{tenant.contact_name || EMPTY_VALUE}</Row>
          <Row label={t("contactEmail")}>{tenant.contact_email || EMPTY_VALUE}</Row>
          <Row label={t("contactPhone")}>{tenant.contact_phone || EMPTY_VALUE}</Row>
          <Row label={t("plan")}>{tenant.current_plan || t("noPlan")}</Row>
          <Row label={t("regional")}>
            {[tenant.timezone, tenant.locale, tenant.currency].filter(Boolean).join(" · ") ||
              EMPTY_VALUE}
          </Row>
          <Row label={t("created")}>{date(tenant.created_at)}</Row>
          <Row label={t("provisioned")}>{date(tenant.provisioned_at)}</Row>
          <Row label={t("trialEnds")}>{date(tenant.trial_ends_at)}</Row>
          <Row label={t("suspended")}>{date(tenant.suspended_at)}</Row>
          <Row label={t("deprovisionAfter")}>{date(tenant.deprovision_after)}</Row>
        </dl>
      </CardContent>
    </Card>
  );
}
