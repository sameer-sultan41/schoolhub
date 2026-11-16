"use client";

import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { ResponsiveAlertDialog } from "@/components/responsive-alert-dialog";
import { useConfirmAction } from "@/hooks/use-confirm-action";
import { useInvalidateModule } from "@/hooks/use-invalidate-module";
import { WEBSITE_QUERY_MODULE } from "@/services/shared/website-content";
import { withReasonText } from "./reason-message";

export interface DeleteContentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  /** The DELETE call. */
  remove: () => Promise<unknown>;
  /** The confirm button; "Delete" by default. */
  confirmLabel?: string;
  /** The toast once it is gone; "Deleted." by default. */
  deletedMessage?: string;
  /** The `website.reasons` scope for the refusal's copy (`reason-message.ts`). */
  reasonScope?: string;
  /** After the record is gone, e.g. to close the sheet or leave the record's page. */
  onDeleted?: () => void;
}

/**
 * Deletes a website record: a page, news post, album or gallery item. The server refuses a
 * published one (`unpublish_first`) and a page in use (`page_in_use`); the refusal shows
 * inline, translated when `website.reasons` knows it, and the dialog stays open.
 *
 * Mounting contract: the caller mounts this only while it is open, so every open starts with no
 * stale error.
 */
export function DeleteContentDialog({
  open,
  onOpenChange,
  title,
  description,
  remove,
  confirmLabel,
  deletedMessage,
  reasonScope,
  onDeleted,
}: DeleteContentDialogProps) {
  const t = useTranslations("website.content");
  const tCommon = useTranslations("common");
  const tReasons = useTranslations("website.reasons");
  const invalidateWebsite = useInvalidateModule(WEBSITE_QUERY_MODULE);

  const { error, isPending, confirm } = useConfirmAction({
    mutationFn: async () => {
      try {
        await remove();
      } catch (refusal) {
        throw withReasonText(refusal, tReasons, reasonScope);
      }
    },
    onSuccess: () => {
      invalidateWebsite();
      toast.success(deletedMessage ?? t("deleted"));
      onOpenChange(false);
      onDeleted?.();
    },
    fallbackMessage: tCommon("submitFailed"),
  });

  return (
    <ResponsiveAlertDialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      confirmLabel={confirmLabel ?? t("delete")}
      variant="destructive"
      isPending={isPending}
      error={error ?? undefined}
      onConfirm={confirm}
    />
  );
}
