"use client";

import { useTranslations } from "next-intl";
import { Badge } from "@schoolhub/ui";
import { FileCheck, FilePen, Send, type LucideIcon } from "lucide-react";

import type { ReportCardStatus } from "@/services";

const STATUS_ICON: Record<ReportCardStatus, LucideIcon> = {
  draft: FilePen,
  generated: FileCheck,
  published: Send,
};

type StatusVariant = "secondary" | "info" | "success";

const STATUS_VARIANT: Record<ReportCardStatus, StatusVariant> = {
  draft: "secondary",
  generated: "info",
  published: "success",
};

/** A card's status as token, icon and label together: `draft` waits for its PDF, `generated` has
 * one, `published` is with the portals. */
export function ReportCardStatusBadge({ status }: { status: ReportCardStatus }) {
  const t = useTranslations("exams");
  const Icon = STATUS_ICON[status];
  return (
    <Badge variant={STATUS_VARIANT[status]} appearance="light">
      <Icon aria-hidden="true" />
      {t(`reportCards.status.${status}`)}
    </Badge>
  );
}
