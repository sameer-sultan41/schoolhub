"use client";

import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { ResponsiveAlertDialog } from "@/components/responsive-alert-dialog";
import { useConfirmAction } from "@/hooks/use-confirm-action";
import { useInvalidateModule } from "@/hooks/use-invalidate-module";
import { WEBSITE_QUERY_MODULE } from "@/services/shared/website-content";
import { useContentErrors } from "./content-errors";

export interface DeleteContentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  /** The DELETE call. */
  remove: () => Promise<unknown>;
  /** After the record is gone, e.g. to close the sheet or leave the album's page. */
  onDeleted?: () => void;
}

/**
 * Removes a news post, an album or a gallery item. The server refuses a published post or album
 * (`unpublish_first`); the refusal shows inline, in the viewer's language, and the dialog stays
 * open.
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
  onDeleted,
}: DeleteContentDialogProps) {
  const t = useTranslations("website.content");
  const tCommon = useTranslations("common");
  const invalidateWebsite = useInvalidateModule(WEBSITE_QUERY_MODULE);
  const { localise } = useContentErrors();

  const { error, isPending, confirm } = useConfirmAction({
    mutationFn: async () => {
      try {
        await remove();
      } catch (failure) {
        throw localise(failure);
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
      title={title}
      description={description}
      confirmLabel={t("delete")}
      variant="destructive"
      isPending={isPending}
      error={error ?? undefined}
      onConfirm={confirm}
    />
  );
}
