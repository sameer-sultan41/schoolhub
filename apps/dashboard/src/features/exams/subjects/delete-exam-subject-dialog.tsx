"use client";

import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { ResponsiveAlertDialog } from "@/components/responsive-alert-dialog";
import { useConfirmAction } from "@/hooks/use-confirm-action";
import { useInvalidateModule } from "@/hooks/use-invalidate-module";
import { Services, type ExamSubjectRecord } from "@/services";
import { EXAM_SUBJECTS_QUERY_MODULE } from "@/services/modules/exam-subjects/exam-subjects-constant";
import { guardRefusal } from "@/features/exams/guard-refusal";

export interface DeleteExamSubjectDialogProps {
  record: ExamSubjectRecord;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Removes one subject from the exam. The server's refusal (the exam moved past `scheduled`) shows
 * inline in its own words and the dialog stays open, with the exam reloaded.
 *
 * Mounting contract: the caller mounts this only while it is open, so every open starts with no
 * stale error.
 */
export function DeleteExamSubjectDialog({
  record,
  open,
  onOpenChange,
}: DeleteExamSubjectDialogProps) {
  const t = useTranslations("exams");
  const tCommon = useTranslations("common");
  const invalidateExams = useInvalidateModule(EXAM_SUBJECTS_QUERY_MODULE);

  const { error, isPending, confirm } = useConfirmAction({
    mutationFn: () =>
      guardRefusal(() => Services.examSubjects.deleteExamSubject(record.id), invalidateExams),
    onSuccess: () => {
      invalidateExams();
      toast.success(t("subjects.removed"));
      onOpenChange(false);
    },
    fallbackMessage: tCommon("submitFailed"),
  });

  return (
    <ResponsiveAlertDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("subjects.delete.titleNamed", {
        subject: record.subject_name,
        class: record.class_name,
      })}
      description={t("subjects.delete.description")}
      confirmLabel={t("subjects.actions.delete")}
      variant="destructive"
      isPending={isPending}
      error={error ?? undefined}
      onConfirm={confirm}
    />
  );
}
