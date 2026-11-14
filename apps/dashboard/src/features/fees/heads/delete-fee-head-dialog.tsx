"use client";

import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { ResponsiveAlertDialog } from "@/components/responsive-alert-dialog";
import { useConfirmAction } from "@/hooks/use-confirm-action";
import { useInvalidateModule } from "@/hooks/use-invalidate-module";
import { Services, type FeeHeadRecord } from "@/services";
import { FEE_HEADS_QUERY_MODULE } from "@/services/modules/fee-heads/fee-heads-constant";

export interface DeleteFeeHeadDialogProps {
  record: FeeHeadRecord;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Deletes one fee head. The server refuses a head a schedule, fine or invoice line refers to
 * (422): the reason shows inline and the dialog stays open.
 *
 * Mounting contract: the caller mounts this only while it is open, so every open starts with
 * no stale error.
 */
export function DeleteFeeHeadDialog({ record, open, onOpenChange }: DeleteFeeHeadDialogProps) {
  const t = useTranslations("fees");
  const tCommon = useTranslations("common");
  const invalidateHeads = useInvalidateModule(FEE_HEADS_QUERY_MODULE);

  const { error, isPending, confirm } = useConfirmAction({
    mutationFn: () => Services.feeHeads.deleteFeeHead(record.id),
    onSuccess: () => {
      invalidateHeads();
      toast.success(t("heads.removed"));
      onOpenChange(false);
    },
    fallbackMessage: tCommon("submitFailed"),
  });

  return (
    <ResponsiveAlertDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("heads.delete.titleNamed", { name: record.name })}
      description={t("heads.delete.description")}
      confirmLabel={t("heads.actions.delete")}
      variant="destructive"
      isPending={isPending}
      error={error ?? undefined}
      onConfirm={confirm}
    />
  );
}
