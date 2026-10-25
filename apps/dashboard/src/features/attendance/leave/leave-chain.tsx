"use client";

import { useLocale, useTranslations } from "next-intl";
import { Badge } from "@schoolhub/ui";
import { Minus } from "lucide-react";

import { RequestStatusBadge } from "@/features/attendance/request-status-badge";
import { EMPTY_VALUE } from "@/lib/constants";
import { formatDate } from "@/lib/helpers";
import type { LeaveApprovalRecord, LeaveStatus } from "@/services";
import {
  isStepNotReached,
  stepPermissionLabelKey,
} from "@/services/modules/leave-requests/leave-requests-helper";

export interface LeaveChainProps {
  approvals: readonly LeaveApprovalRecord[];
  /** The request's own status: a step still pending on a decided request was never reached. */
  requestStatus: LeaveStatus;
}

/** One level of the chain: its key, its decision (or "Not reached"), who decided and the note. */
function LeaveChainStep({
  step,
  requestStatus,
}: {
  step: LeaveApprovalRecord;
  requestStatus: LeaveStatus;
}) {
  const t = useTranslations("attendance");
  const locale = useLocale();
  const notReached = isStepNotReached(step, requestStatus);
  // A known key reads as its label; an unknown one shows raw rather than nothing.
  const labelKey = stepPermissionLabelKey(step.required_permission);
  const permission = labelKey
    ? t(`leave.detail.chain.permission.${labelKey}`)
    : step.required_permission;

  return (
    <li className="flex flex-col gap-1.5 rounded-md border border-border px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-foreground">
          {t("leave.detail.chain.level", { level: step.level })}
        </span>
        {notReached ? (
          // Neutral, not the warning "Pending": no one waits on a step never reached.
          <Badge variant="secondary" appearance="light">
            <Minus aria-hidden="true" />
            {t("leave.detail.chain.notReached")}
          </Badge>
        ) : (
          <RequestStatusBadge status={step.decision} />
        )}
      </div>
      <span className="text-xs text-muted-foreground">
        {t("leave.detail.chain.requires", { key: permission })}
      </span>
      {step.decided_at && (
        <span className="text-sm text-foreground">
          {step.approver_name ?? EMPTY_VALUE}
          <span className="block text-xs text-muted-foreground">
            {t("leave.detail.chain.decidedOn", { date: formatDate(step.decided_at, locale) })}
          </span>
        </span>
      )}
      {!step.decided_at && !notReached && (
        <span className="text-sm text-muted-foreground">{t("leave.detail.chain.waiting")}</span>
      )}
      {step.note && (
        <span className="text-sm whitespace-pre-wrap text-foreground">{step.note}</span>
      )}
    </li>
  );
}

/** The approval chain, one step per level, in level order. A step still waiting says so; one a
 * rejection or cancellation cut off says "Not reached", never "Waiting". */
export function LeaveChain({ approvals, requestStatus }: LeaveChainProps) {
  const t = useTranslations("attendance");
  const steps = [...approvals].sort((a, b) => a.level - b.level);

  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold text-foreground">{t("leave.detail.chain.title")}</h3>
      <ol className="flex flex-col gap-2">
        {steps.map((step) => (
          <LeaveChainStep key={step.id} step={step} requestStatus={requestStatus} />
        ))}
      </ol>
    </section>
  );
}
