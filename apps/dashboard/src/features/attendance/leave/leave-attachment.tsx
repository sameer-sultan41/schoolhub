"use client";

import { useMutation } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@schoolhub/ui";
import { Paperclip } from "lucide-react";

import { resolveErrorMessage } from "@/lib/error-message";
import { downloadFile } from "@/lib/helpers";
import { Services } from "@/services";

/**
 * A request's supporting file. The download is the request's own
 * `/leave-requests/{id}/attachment:download`, under the same scope that let the viewer open the
 * request, so whoever sees the request may open its document; `/files` never signs a leave
 * attachment. A fresh signed URL is fetched per click: it expires.
 */
export function LeaveAttachment({
  requestId,
  hasAttachment,
}: {
  requestId: string;
  hasAttachment: boolean;
}) {
  const t = useTranslations("attendance");
  const tErrors = useTranslations("errors");

  const download = useMutation({
    mutationFn: () => Services.leaveRequests.fetchLeaveAttachmentUrl(requestId),
    onSuccess: (url) => {
      downloadFile(url);
    },
    onError: (error) => {
      toast.error(resolveErrorMessage(error, tErrors, t("leave.detail.attachment.failed")));
    },
  });

  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold text-foreground">
        {t("leave.detail.attachment.title")}
      </h3>
      {hasAttachment ? (
        <Button
          variant="outline"
          className="w-fit"
          disabled={download.isPending}
          onClick={() => {
            download.mutate();
          }}
        >
          <Paperclip aria-hidden="true" />
          {t(
            download.isPending
              ? "leave.detail.attachment.downloading"
              : "leave.detail.attachment.download",
          )}
        </Button>
      ) : (
        <p className="text-sm text-muted-foreground">{t("leave.detail.attachment.none")}</p>
      )}
    </section>
  );
}
