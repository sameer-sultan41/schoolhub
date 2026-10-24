"use client";

import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { ResponsiveAlertDialog } from "@/components/responsive-alert-dialog";
import { useConfirmAction } from "@/hooks/use-confirm-action";
import { useInvalidateModule } from "@/hooks/use-invalidate-module";
import { Services, type PeriodRecord } from "@/services";
import { PERIODS_QUERY_MODULE } from "@/services/modules/periods/periods-constant";

export interface DeletePeriodDialogProps {
  record: PeriodRecord;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Removes one period from the bell schedule. The server refuses one a current grid cell or
 * upcoming cover still runs on (`periods/services.assert_period_not_in_use`) and says why;
 * that shows inline and the dialog stays open.
 *
 * Mounting contract: the caller mounts this only while it is open, so every open starts with
 * no stale error.
 */
export function DeletePeriodDialog({ record, open, onOpenChange }: DeletePeriodDialogProps) {
  const t = useTranslations("timetable");
  const tCommon = useTranslations("common");
  const invalidatePeriods = useInvalidateModule(PERIODS_QUERY_MODULE);

  const { error, isPending, confirm } = useConfirmAction({
    mutationFn: () => Services.periods.deletePeriod(record.id),
    onSuccess: () => {
      invalidatePeriods();
      toast.success(t("periods.removed"));
      onOpenChange(false);
    },
    fallbackMessage: tCommon("submitFailed"),
  });

  return (
    <ResponsiveAlertDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("periods.delete.titleNamed", { name: record.name })}
      description={t("periods.delete.description")}
      confirmLabel={t("periods.actions.delete")}
      variant="destructive"
      isPending={isPending}
      error={error ?? undefined}
      onConfirm={confirm}
    />
  );
}
