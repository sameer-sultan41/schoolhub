"use client";

import { useTranslations } from "next-intl";
import { Badge } from "@schoolhub/ui";
import { Ban, Check, Hourglass, SkipForward, X, type LucideIcon } from "lucide-react";

import type { CorrectionStatus, LeaveApprovalDecision } from "@/services";

/** What a request or one step of its chain can be: a correction's or a leave request's status,
 * or a leave step's decision (which adds `skipped`). */
export type RequestStatus = CorrectionStatus | LeaveApprovalDecision;

const STATUS_ICON: Record<RequestStatus, LucideIcon> = {
  pending: Hourglass,
  approved: Check,
  rejected: X,
  cancelled: Ban,
  skipped: SkipForward,
};

type StatusVariant = "warning" | "success" | "destructive" | "secondary";

const STATUS_VARIANT: Record<RequestStatus, StatusVariant> = {
  pending: "warning",
  approved: "success",
  rejected: "destructive",
  cancelled: "secondary",
  skipped: "secondary",
};

/** A request's status as color, icon and label together (`attendance.requestStatus.*`):
 * the corrections queue's, the leave queue's and a leave step's decision. */
export function RequestStatusBadge({ status }: { status: RequestStatus }) {
  const t = useTranslations("attendance");
  const Icon = STATUS_ICON[status];
  return (
    <Badge variant={STATUS_VARIANT[status]} appearance="light">
      <Icon aria-hidden="true" />
      {t(`requestStatus.${status}`)}
    </Badge>
  );
}
