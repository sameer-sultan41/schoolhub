"use client";

import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { ResponsiveAlertDialog } from "@/components/responsive-alert-dialog";
import { useConfirmAction } from "@/hooks/use-confirm-action";
import { useInvalidateModule } from "@/hooks/use-invalidate-module";
import { Services, type WebsitePageRecord } from "@/services";
import { WEBSITE_QUERY_MODULE } from "@/services/shared/website-content";
import { withReasonText } from "@/features/website/shared/reason-message";

export interface DeletePageDialogProps {
  page: WebsitePageRecord;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** After the page is gone: the editor leaves for the list. */
  onDeleted?: () => void;
}

/**
 * Deletes one page. The API refuses a published page (`unpublish_first`) and one that is the
 * home page or a menu's link (`page_in_use`); the refusal shows inline, translated, and the
 * dialog stays open.
 *
 * Mounting contract: the caller mounts this only while it is open, so every open starts with
 * no stale error.
 */
export function DeletePageDialog({ page, open, onOpenChange, onDeleted }: DeletePageDialogProps) {
  const t = useTranslations("website.pages");
  const tCommon = useTranslations("common");
  const tReasons = useTranslations("website.reasons");
  const invalidateWebsite = useInvalidateModule(WEBSITE_QUERY_MODULE);

  const { error, isPending, confirm } = useConfirmAction({
    mutationFn: async () => {
      try {
        await Services.websitePages.deleteWebsitePage(page.id);
      } catch (refusal) {
        throw withReasonText(refusal, tReasons);
      }
    },
    onSuccess: () => {
      invalidateWebsite();
      toast.success(t("deleted"));
      onOpenChange(false);
      onDeleted?.();
    },
    fallbackMessage: tCommon("submitFailed"),
  });

  return (
    <ResponsiveAlertDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("delete.title", { title: page.title })}
      description={t("delete.description")}
      confirmLabel={t("actions.delete")}
      variant="destructive"
      isPending={isPending}
      error={error ?? undefined}
      onConfirm={confirm}
    />
  );
}
