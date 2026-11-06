"use client";

import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { ResponsiveAlertDialog } from "@/components/responsive-alert-dialog";
import { useConfirmAction } from "@/hooks/use-confirm-action";
import { useInvalidateModule } from "@/hooks/use-invalidate-module";
import { Services, type GradingScaleRecord } from "@/services";
import { GRADING_SCALES_QUERY_MODULE } from "@/services/modules/grading-scales/grading-scales-constant";

export interface DeleteGradingScaleDialogProps {
  record: GradingScaleRecord;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Removes one grading scale. The server's refusal (a scale an exam still uses) shows inline and
 * the dialog stays open.
 *
 * Mounting contract: the caller mounts this only while it is open, so every open starts with
 * no stale error.
 */
export function DeleteGradingScaleDialog({
  record,
  open,
  onOpenChange,
}: DeleteGradingScaleDialogProps) {
  const t = useTranslations("exams");
  const tCommon = useTranslations("common");
  const invalidateScales = useInvalidateModule(GRADING_SCALES_QUERY_MODULE);

  const { error, isPending, confirm } = useConfirmAction({
    mutationFn: () => Services.gradingScales.deleteScale(record.id),
    onSuccess: () => {
      invalidateScales();
      toast.success(t("gradingScales.removed"));
      onOpenChange(false);
    },
    fallbackMessage: tCommon("submitFailed"),
  });

  return (
    <ResponsiveAlertDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("gradingScales.delete.titleNamed", { name: record.name })}
      description={t("gradingScales.delete.description")}
      confirmLabel={t("gradingScales.actions.delete")}
      variant="destructive"
      isPending={isPending}
      error={error ?? undefined}
      onConfirm={confirm}
    />
  );
}
