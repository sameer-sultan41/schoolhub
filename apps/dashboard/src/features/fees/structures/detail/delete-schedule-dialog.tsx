"use client";

import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { ResponsiveAlertDialog } from "@/components/responsive-alert-dialog";
import { useConfirmAction } from "@/hooks/use-confirm-action";
import { useInvalidateModule } from "@/hooks/use-invalidate-module";
import { Services, type FeeScheduleRecord } from "@/services";
import { FEE_STRUCTURES_QUERY_MODULE } from "@/services/modules/fee-structures/fee-structures-constant";

export interface DeleteScheduleDialogProps {
  record: FeeScheduleRecord;
  /** The fee head's display name, for the title. */
  headName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Removes one schedule from a draft structure. A refusal shows inline and the dialog stays open.
 *
 * Mounting contract: the caller mounts this only while it is open, so every open starts with
 * no stale error.
 */
export function DeleteScheduleDialog({
  record,
  headName,
  open,
  onOpenChange,
}: DeleteScheduleDialogProps) {
  const t = useTranslations("fees");
  const tCommon = useTranslations("common");
  const invalidateStructures = useInvalidateModule(FEE_STRUCTURES_QUERY_MODULE);

  const { error, isPending, confirm } = useConfirmAction({
    mutationFn: () => Services.feeSchedules.deleteFeeSchedule(record.id),
    onSuccess: () => {
      invalidateStructures();
      toast.success(t("structures.schedules.removed"));
      onOpenChange(false);
    },
    fallbackMessage: tCommon("submitFailed"),
  });

  return (
    <ResponsiveAlertDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("structures.schedules.delete.titleNamed", { name: headName })}
      description={t("structures.schedules.delete.description")}
      confirmLabel={t("structures.schedules.delete.confirm")}
      variant="destructive"
      isPending={isPending}
      error={error ?? undefined}
      onConfirm={confirm}
    />
  );
}
