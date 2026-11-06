"use client";

import { useState } from "react";
import { CalendarOff } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Button, Card, CardContent, EmptyState, Skeleton } from "@schoolhub/ui";

import { LoadErrorCard } from "@/components/load-error-card";
import { RequestStatusBadge } from "@/features/attendance/request-status-badge";
import { enumLabel } from "@/features/portal/enum-label";
import { PortalDownloadButton } from "@/features/portal/portal-download-button";
import { downloadFile, formatDate } from "@/lib/helpers";
import { Services, type LeaveRequestRecord } from "@/services";
import { LEAVE_DEFAULT_DAY_PART } from "@/services/modules/leave-requests/leave-requests-constant";
import { CancelLeaveDialog } from "./cancel-leave-dialog";
import { LEAVE_DAY_PART_LABEL_KEY } from "./leave-labels";
import { useChildLeave } from "./use-child-leave";

/** One child's requests, with Cancel on a pending one and a download for an attached document
 * (the request's own `attachment:download`, so only a reader of the request gets the file). */
export function LeaveList({ studentId }: { studentId: string }) {
  const t = useTranslations("portal.leave");
  const locale = useLocale();
  const query = useChildLeave(studentId);
  const [cancelling, setCancelling] = useState<LeaveRequestRecord | null>(null);

  const datesOf = (request: LeaveRequestRecord) =>
    request.start_date === request.end_date
      ? formatDate(request.start_date, locale)
      : t("range", {
          from: formatDate(request.start_date, locale),
          to: formatDate(request.end_date, locale),
        });

  if (query.isPending) return <Skeleton className="h-24 w-full" />;
  if (query.isError) {
    return (
      <LoadErrorCard
        message={t("loadError")}
        onRetry={() => {
          void query.refetch();
        }}
      />
    );
  }
  if (query.data.length === 0) {
    return (
      <EmptyState icon={CalendarOff} title={t("emptyTitle")} description={t("emptyDescription")} />
    );
  }

  return (
    <>
      <Card>
        <CardContent>
          <ul className="divide-y divide-border">
            {query.data.map((request) => (
              <li
                key={request.id}
                className="flex flex-wrap items-start justify-between gap-3 py-3"
              >
                <div className="space-y-1">
                  <p className="font-medium text-foreground">{request.leave_type_name}</p>
                  <p className="text-xs text-muted-foreground">
                    {[
                      datesOf(request),
                      t("days", { count: Number(request.days_count) }),
                      enumLabel(
                        t,
                        LEAVE_DAY_PART_LABEL_KEY,
                        request.day_part ?? LEAVE_DEFAULT_DAY_PART,
                      ),
                    ].join(" · ")}
                  </p>
                  <p className="text-sm text-foreground">{request.reason}</p>
                  {request.attachment_file_id ? (
                    <PortalDownloadButton
                      label={t("downloadAttachment", {
                        type: request.leave_type_name,
                        range: datesOf(request),
                      })}
                      failedMessage={t("attachmentFailed")}
                      download={async () => {
                        downloadFile(
                          await Services.leaveRequests.fetchLeaveAttachmentUrl(request.id),
                        );
                      }}
                    />
                  ) : null}
                </div>
                <div className="flex flex-col items-end gap-2">
                  <RequestStatusBadge status={request.status} />
                  {request.status === "pending" ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setCancelling(request);
                      }}
                    >
                      {t("cancel.open")}
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
      {cancelling && (
        <CancelLeaveDialog
          request={cancelling}
          onOpenChange={(open) => {
            if (!open) setCancelling(null);
          }}
        />
      )}
    </>
  );
}
