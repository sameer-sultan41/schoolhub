"use client";

import { useTranslations } from "next-intl";
import { Badge } from "@schoolhub/ui";
import { Ban, BadgeCheck, Hourglass, type LucideIcon } from "lucide-react";

import type { AdmitCardStatus } from "@/services";

const STATUS_ICON: Record<AdmitCardStatus, LucideIcon> = {
  generated: Hourglass,
  issued: BadgeCheck,
  revoked: Ban,
};

type StatusVariant = "secondary" | "success" | "destructive";

const STATUS_VARIANT: Record<AdmitCardStatus, StatusVariant> = {
  generated: "secondary",
  issued: "success",
  revoked: "destructive",
};

/** A card's status as token, icon and label together (`exams.admitCards.status.*`): `generated`
 * waits for its PDF, `issued` has one, `revoked` was withdrawn. */
export function AdmitCardStatusBadge({ status }: { status: AdmitCardStatus }) {
  const t = useTranslations("exams");
  const Icon = STATUS_ICON[status];
  return (
    <Badge variant={STATUS_VARIANT[status]} appearance="light">
      <Icon aria-hidden="true" />
      {t(`admitCards.status.${status}`)}
    </Badge>
  );
}
