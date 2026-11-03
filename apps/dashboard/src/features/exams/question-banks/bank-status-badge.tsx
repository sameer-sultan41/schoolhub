"use client";

import { useTranslations } from "next-intl";
import { Badge } from "@schoolhub/ui";
import { Archive, CircleCheck, type LucideIcon } from "lucide-react";

import type { QuestionBankStatus } from "@/services";

const STATUS_ICON: Record<QuestionBankStatus, LucideIcon> = {
  active: CircleCheck,
  archived: Archive,
};

const STATUS_VARIANT: Record<QuestionBankStatus, "success" | "secondary"> = {
  active: "success",
  archived: "secondary",
};

/** A bank's status as token, icon and label together (`exams.questionBanks.status.*`). */
export function BankStatusBadge({ status }: { status: QuestionBankStatus }) {
  const t = useTranslations("exams");
  const Icon = STATUS_ICON[status];
  return (
    <Badge variant={STATUS_VARIANT[status]} appearance="light">
      <Icon aria-hidden="true" />
      {t(`questionBanks.status.${status}`)}
    </Badge>
  );
}
