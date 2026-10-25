"use client";

import type { ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";

import {
  ResponsiveSheet,
  ResponsiveSheetBody,
  ResponsiveSheetContent,
  ResponsiveSheetTitle,
} from "@/components/responsive-dialog";
import { LeaveAttachment } from "@/features/attendance/leave/leave-attachment";
import { LeaveChain } from "@/features/attendance/leave/leave-chain";
import { useLeaveDates } from "@/features/attendance/leave/use-leave-dates";
import { RequestStatusBadge } from "@/features/attendance/request-status-badge";
import { EMPTY_VALUE } from "@/lib/constants";
import type { LeaveRequestRecord } from "@/services";
import { LEAVE_DEFAULT_DAY_PART } from "@/services/modules/leave-requests/leave-requests-constant";
import { formatLeaveDays } from "@/services/modules/leave-requests/leave-requests-helper";

export interface LeaveDetailSheetProps {
  /** The request to show; `null` closes the sheet. */
  request: LeaveRequestRecord | null;
  onOpenChange: (open: boolean) => void;
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium text-foreground">{children}</dd>
    </div>
  );
}

/**
 * A leave request in full: who, when and why, the approval chain (each level, the key it needs,
 * who decided, how, and the note) and the supporting file. Read-only: Approve and Reject are
 * the queue's row actions. The record is the list's own, so no further request is made.
 */
export function LeaveDetailSheet({ request, onOpenChange }: LeaveDetailSheetProps) {
  const t = useTranslations("attendance");
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const leaveDates = useLeaveDates();

  return (
    <ResponsiveSheet open={request !== null} onOpenChange={onOpenChange}>
      <ResponsiveSheetContent
        closeLabel={tCommon("close")}
        className="gap-0 p-0 sm:w-[440px] sm:max-w-none"
      >
        <div className="flex flex-col gap-1.5 border-b border-border px-6 py-5 pe-14">
          <ResponsiveSheetTitle className="text-lg font-semibold">
            {request ? t("leave.detail.title", { name: request.student_name }) : ""}
          </ResponsiveSheetTitle>
          {request && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-muted-foreground">
                {t("leave.detail.admissionNumber", { number: request.admission_number })}
              </span>
              <RequestStatusBadge status={request.status} />
            </div>
          )}
        </div>
        {request && (
          <ResponsiveSheetBody className="flex flex-col gap-6 px-6 py-5">
            <dl className="grid grid-cols-2 gap-x-3 gap-y-4">
              <Fact label={t("leave.detail.fields.section")}>
                {request.section_name ?? EMPTY_VALUE}
              </Fact>
              <Fact label={t("leave.detail.fields.type")}>{request.leave_type_name}</Fact>
              <Fact label={t("leave.detail.fields.dates")}>{leaveDates(request)}</Fact>
              <Fact label={t("leave.detail.fields.dayPart")}>
                {t(`leave.dayPart.${request.day_part ?? LEAVE_DEFAULT_DAY_PART}`)}
              </Fact>
              <Fact label={t("leave.detail.fields.days")}>
                {formatLeaveDays(request.days_count, locale)}
              </Fact>
              <Fact label={t("leave.detail.fields.submittedBy")}>
                {request.submitted_by_name ?? EMPTY_VALUE}
              </Fact>
            </dl>
            <section className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold text-foreground">{t("leave.detail.reason")}</h3>
              <p className="text-sm whitespace-pre-wrap text-foreground">{request.reason}</p>
            </section>
            <LeaveChain approvals={request.approvals} requestStatus={request.status} />
            <LeaveAttachment fileId={request.attachment_file_id} />
          </ResponsiveSheetBody>
        )}
      </ResponsiveSheetContent>
    </ResponsiveSheet>
  );
}
