"use client";

import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { ResponsiveAlertDialog } from "@/components/responsive-alert-dialog";
import { useConfirmAction } from "@/hooks/use-confirm-action";
import { useInvalidateModule } from "@/hooks/use-invalidate-module";
import { Services, type SittingRecord } from "@/services";
import { EXAM_SCHEDULES_QUERY_MODULE } from "@/services/modules/exam-schedules/exam-schedules-constant";
import { guardRefusal } from "@/features/exams/guard-refusal";

export type SittingAction = "cancel" | "delete";

export interface SittingActionDialogProps {
  action: SittingAction;
  record: SittingRecord;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Calls a sitting off (a status change: the row stays, its room is freed) or deletes it (a draft
 * exam only: the caller offers it only there). The server's refusal (the sitting is no longer
 * scheduled) shows inline in its own words and the dialog stays open, with the exam reloaded.
 *
 * Mounting contract: the caller mounts this only while it is open, so every open starts with no
 * stale error.
 */
export function SittingActionDialog({
  action,
  record,
  open,
  onOpenChange,
}: SittingActionDialogProps) {
  const t = useTranslations("exams");
  const tCommon = useTranslations("common");
  const invalidateExams = useInvalidateModule(EXAM_SCHEDULES_QUERY_MODULE);

  const { error, isPending, confirm } = useConfirmAction({
    mutationFn: () =>
      guardRefusal(
        () =>
          action === "cancel"
            ? Services.examSchedules.cancelSitting(record.id)
            : Services.examSchedules.deleteSitting(record.id),
        invalidateExams,
      ),
    onSuccess: () => {
      invalidateExams();
      toast.success(t(`schedule.${action}.done`));
      onOpenChange(false);
    },
    fallbackMessage: tCommon("submitFailed"),
  });

  return (
    <ResponsiveAlertDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t(`schedule.${action}.title`, {
        subject: record.subject_name,
        class: record.class_name,
        section: record.section_name,
      })}
      description={t(`schedule.${action}.description`)}
      confirmLabel={t(`schedule.${action}.confirm`)}
      variant="destructive"
      isPending={isPending}
      error={error ?? undefined}
      onConfirm={confirm}
    />
  );
}
