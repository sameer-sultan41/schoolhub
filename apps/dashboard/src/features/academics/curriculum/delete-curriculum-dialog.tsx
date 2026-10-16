"use client";

import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { ResponsiveAlertDialog } from "@/components/responsive-alert-dialog";
import { useConfirmAction } from "@/hooks/use-confirm-action";
import { Services, type CurriculumRecord } from "@/services";
import { useInvalidateCurriculum } from "./use-invalidate-curriculum";

export interface DeleteCurriculumDialogProps {
  record: CurriculumRecord;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Removes one subject from a class's curriculum. The server may refuse (it would leave an
 * elective group with a single option, the mapping has live dependents, or the session is
 * locked), and says why in a 422; that shows inline and the dialog stays open.
 *
 * Mounting contract: the caller mounts this only while it is open, so every open starts
 * with no stale error.
 */
export function DeleteCurriculumDialog({
  record,
  open,
  onOpenChange,
}: DeleteCurriculumDialogProps) {
  const t = useTranslations("academics");
  const invalidateCurriculum = useInvalidateCurriculum();

  const { error, isPending, confirm } = useConfirmAction({
    mutationFn: () => Services.curriculum.deleteCurriculum(record.id),
    onSuccess: () => {
      invalidateCurriculum();
      toast.success(t("curriculum.removed"));
      onOpenChange(false);
    },
    fallbackMessage: t("common.submitFailed"),
  });

  return (
    <ResponsiveAlertDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("curriculum.delete.title")}
      description={t("curriculum.delete.description", { subject: record.subject_name })}
      confirmLabel={t("curriculum.actions.delete")}
      variant="destructive"
      isPending={isPending}
      error={error ?? undefined}
      onConfirm={confirm}
    />
  );
}
