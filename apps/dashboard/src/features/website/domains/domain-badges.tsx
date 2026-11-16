"use client";

import { useTranslations } from "next-intl";
import { Badge } from "@schoolhub/ui";

import { enumBadge, enumLabel } from "@/lib/enum-label";
import type { CustomDomainRecord } from "@/services";
import {
  DOMAIN_STATUS_BADGE,
  DOMAIN_STATUS_LABEL_KEY,
  TLS_STATUS_BADGE,
  TLS_STATUS_LABEL_KEY,
} from "./domain-labels";

/** A domain's status, its HTTPS certificate and whether it is the primary host. */
export function DomainBadges({ domain }: { domain: CustomDomainRecord }) {
  const t = useTranslations("website.domains");

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Badge
        variant={enumBadge(DOMAIN_STATUS_BADGE, domain.status, "secondary")}
        appearance="light"
      >
        {enumLabel(t, DOMAIN_STATUS_LABEL_KEY, domain.status)}
      </Badge>
      <Badge
        variant={enumBadge(TLS_STATUS_BADGE, domain.tls_status, "secondary")}
        appearance="light"
      >
        {enumLabel(t, TLS_STATUS_LABEL_KEY, domain.tls_status)}
      </Badge>
      {domain.is_primary ? (
        <Badge variant="primary" appearance="light">
          {t("primary")}
        </Badge>
      ) : null}
    </div>
  );
}
