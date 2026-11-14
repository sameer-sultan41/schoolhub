"use client";

import { useTranslations } from "next-intl";
import { Badge } from "@schoolhub/ui";

import { enumBadge, enumLabel } from "@/lib/enum-label";
import type { FeeInvoiceStatus } from "@/services";
import { FEE_STATUS_BADGE, FEE_STATUS_LABEL_KEY } from "./fee-status";

/**
 * An invoice's status as a badge. The labels are the parent portal's own (`portal.fees.status.*`),
 * so a family and the accountant read the same word for the same state; one exhaustive record
 * (`fee-status.ts`) serves both.
 */
export function InvoiceStatusBadge({ status }: { status: FeeInvoiceStatus }) {
  const t = useTranslations("portal.fees");
  return (
    <Badge variant={enumBadge(FEE_STATUS_BADGE, status, "secondary")} appearance="light">
      {enumLabel(t, FEE_STATUS_LABEL_KEY, status)}
    </Badge>
  );
}
