"use client";

import { useMutation } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@schoolhub/ui";
import { Paperclip } from "lucide-react";

import { useCurrentUser } from "@/hooks/use-current-user";
import { resolveErrorMessage } from "@/lib/error-message";
import { downloadFile } from "@/lib/helpers";
import { hasPermission } from "@/lib/permissions";
import { Services } from "@/services";

/**
 * A request's supporting file. The download goes through the platform's file endpoint
 * (`Services.jobs.fetchFileDownloadUrl`, keyed `platform.file.view`, which every approver role
 * holds), so a viewer without that key sees the file as attached and no button. A fresh signed
 * URL is fetched per click: it expires.
 */
export function LeaveAttachment({ fileId }: { fileId: string | null | undefined }) {
  const t = useTranslations("attendance");
  const tErrors = useTranslations("errors");
  const { data: currentUser } = useCurrentUser();
  const canDownload = hasPermission(currentUser, "platform.file.view");

  const download = useMutation({
    mutationFn: (id: string) => Services.jobs.fetchFileDownloadUrl(id),
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
      {!fileId && (
        <p className="text-sm text-muted-foreground">{t("leave.detail.attachment.none")}</p>
      )}
      {fileId && !canDownload && (
        <p className="text-sm text-muted-foreground">{t("leave.detail.attachment.onFile")}</p>
      )}
      {fileId && canDownload && (
        <Button
          variant="outline"
          className="w-fit"
          disabled={download.isPending}
          onClick={() => {
            download.mutate(fileId);
          }}
        >
          <Paperclip aria-hidden="true" />
          {t(
            download.isPending
              ? "leave.detail.attachment.downloading"
              : "leave.detail.attachment.download",
          )}
        </Button>
      )}
    </section>
  );
}
