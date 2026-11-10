"use client";

import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { ResponsiveAlertDialog } from "@/components/responsive-alert-dialog";
import { useConfirmAction } from "@/hooks/use-confirm-action";
import { useInvalidateModule } from "@/hooks/use-invalidate-module";
import { Services, type GradeBandRecord } from "@/services";
import { GRADING_SCALES_QUERY_MODULE } from "@/services/modules/grading-scales/grading-scales-constant";

export interface DeleteGradeBandDialogProps {
  scaleId: string;
  band: GradeBandRecord;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Removes one band. The server's refusal shows inline and the dialog stays open.
 *
 * Mounting contract: the caller mounts this only while it is open, so every open starts with
 * no stale error.
 */
export function DeleteGradeBandDialog({
  scaleId,
  band,
  open,
  onOpenChange,
}: DeleteGradeBandDialogProps) {
  const t = useTranslations("exams");
  const tCommon = useTranslations("common");
  const invalidateScales = useInvalidateModule(GRADING_SCALES_QUERY_MODULE);

  const { error, isPending, confirm } = useConfirmAction({
    mutationFn: () => Services.gradingScales.deleteBand(scaleId, band.id),
    onSuccess: () => {
      invalidateScales();
      toast.success(t("gradingScales.bands.removed"));
      onOpenChange(false);
    },
    fallbackMessage: tCommon("submitFailed"),
  });

  return (
    <ResponsiveAlertDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("gradingScales.bands.delete.titleNamed", { label: band.label })}
      description={t("gradingScales.bands.delete.description")}
      confirmLabel={t("gradingScales.bands.actions.delete")}
      variant="destructive"
      isPending={isPending}
      error={error ?? undefined}
      onConfirm={confirm}
    />
  );
}
