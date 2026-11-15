"use client";

import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { ResponsiveAlertDialog } from "@/components/responsive-alert-dialog";
import { useConfirmAction } from "@/hooks/use-confirm-action";
import { useInvalidateModule } from "@/hooks/use-invalidate-module";
import { SCHOOL_ORGANIZATION_QUERY_MODULE } from "@/services/modules/school-organization/school-organization-constant";

export interface RemoveRecordDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The record's name, shown in the title. */
  name: string;
  remove: () => Promise<unknown>;
}

/**
 * Removes one campus, department, house, class, section, subject or holiday. The server refuses
 * a structure record that other records still point at (`services.assert_deletable`, a 422
 * naming them and saying to deactivate it instead); that sentence shows inline and the dialog
 * stays open.
 *
 * Mounting contract: the caller mounts this only while it is open, so every open starts with
 * no stale error.
 */
export function RemoveRecordDialog({ open, onOpenChange, name, remove }: RemoveRecordDialogProps) {
  const t = useTranslations("school");
  const tCommon = useTranslations("common");
  const invalidate = useInvalidateModule(SCHOOL_ORGANIZATION_QUERY_MODULE);

  const { error, isPending, confirm } = useConfirmAction({
    mutationFn: remove,
    onSuccess: () => {
      invalidate();
      toast.success(t("remove.removed", { name }));
      onOpenChange(false);
    },
    fallbackMessage: tCommon("submitFailed"),
  });

  return (
    <ResponsiveAlertDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("remove.title", { name })}
      description={t("remove.description")}
      confirmLabel={t("actions.remove")}
      variant="destructive"
      isPending={isPending}
      error={error ?? undefined}
      onConfirm={confirm}
    />
  );
}
