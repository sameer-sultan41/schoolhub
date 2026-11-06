"use client";

import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { ResponsiveAlertDialog } from "@/components/responsive-alert-dialog";
import { useConfirmAction } from "@/hooks/use-confirm-action";
import { useInvalidateModule } from "@/hooks/use-invalidate-module";
import { Services, type ExamRecord } from "@/services";
import { EXAMS_QUERY_MODULE } from "@/services/modules/exams/exams-constant";
import { guardRefusal } from "@/features/exams/guard-refusal";

export interface DeleteExamDialogProps {
  record: ExamRecord;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Runs after the exam is gone, e.g. to leave its own page. */
  onDeleted?: () => void;
}

/**
 * Deletes one exam (a draft only: the caller offers it for no other). The server's refusal, in
 * its own words ("Only a draft exam can be deleted."), shows inline and the dialog stays open,
 * and the exam is reloaded, since it has moved on.
 *
 * Mounting contract: the caller mounts this only while it is open, so every open starts with no
 * stale error.
 */
export function DeleteExamDialog({ record, open, onOpenChange, onDeleted }: DeleteExamDialogProps) {
  const t = useTranslations("exams");
  const tCommon = useTranslations("common");
  const invalidateExams = useInvalidateModule(EXAMS_QUERY_MODULE);

  const { error, isPending, confirm } = useConfirmAction({
    mutationFn: () => guardRefusal(() => Services.exams.deleteExam(record.id), invalidateExams),
    onSuccess: () => {
      invalidateExams();
      toast.success(t("removed"));
      onOpenChange(false);
      onDeleted?.();
    },
    fallbackMessage: tCommon("submitFailed"),
  });

  return (
    <ResponsiveAlertDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("delete.titleNamed", { name: record.name })}
      description={t("delete.description")}
      confirmLabel={t("actions.delete")}
      variant="destructive"
      isPending={isPending}
      error={error ?? undefined}
      onConfirm={confirm}
    />
  );
}
