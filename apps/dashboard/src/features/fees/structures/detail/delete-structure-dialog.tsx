"use client";

import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { ResponsiveAlertDialog } from "@/components/responsive-alert-dialog";
import { useConfirmAction } from "@/hooks/use-confirm-action";
import { useInvalidateModule } from "@/hooks/use-invalidate-module";
import { Services, type FeeStructureRecord } from "@/services";
import { FEE_STRUCTURES_QUERY_MODULE } from "@/services/modules/fee-structures/fee-structures-constant";

export interface DeleteStructureDialogProps {
  record: FeeStructureRecord;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** After the structure is gone: its own page leaves for the list. */
  onDeleted: () => void;
}

/**
 * Deletes one structure (a draft: the page offers it only then). A refusal shows inline and the
 * dialog stays open.
 *
 * Mounting contract: the caller mounts this only while it is open, so every open starts with
 * no stale error.
 */
export function DeleteStructureDialog({
  record,
  open,
  onOpenChange,
  onDeleted,
}: DeleteStructureDialogProps) {
  const t = useTranslations("fees");
  const tCommon = useTranslations("common");
  const invalidateStructures = useInvalidateModule(FEE_STRUCTURES_QUERY_MODULE);

  const { error, isPending, confirm } = useConfirmAction({
    mutationFn: () => Services.feeStructures.deleteFeeStructure(record.id),
    onSuccess: () => {
      invalidateStructures();
      toast.success(t("structures.removed"));
      onOpenChange(false);
      onDeleted();
    },
    fallbackMessage: tCommon("submitFailed"),
  });

  return (
    <ResponsiveAlertDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("structures.delete.titleNamed", { name: record.name })}
      description={t("structures.delete.description")}
      confirmLabel={t("structures.actions.delete")}
      variant="destructive"
      isPending={isPending}
      error={error ?? undefined}
      onConfirm={confirm}
    />
  );
}
