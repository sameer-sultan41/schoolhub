"use client";

import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { ResponsiveAlertDialog } from "@/components/responsive-alert-dialog";
import { useConfirmAction } from "@/hooks/use-confirm-action";
import { useInvalidateModule } from "@/hooks/use-invalidate-module";
import { Services, type QuestionBankRecord } from "@/services";
import { QUESTION_BANKS_QUERY_MODULE } from "@/services/modules/question-banks/question-banks-constant";

export interface DeleteQuestionBankDialogProps {
  record: QuestionBankRecord;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** After the bank is gone: the bank's own page leaves for the list. */
  onDeleted?: () => void;
}

/**
 * Removes one question bank and its questions. A refusal shows inline and the dialog stays open.
 *
 * Mounting contract: the caller mounts this only while it is open, so every open starts with
 * no stale error.
 */
export function DeleteQuestionBankDialog({
  record,
  open,
  onOpenChange,
  onDeleted,
}: DeleteQuestionBankDialogProps) {
  const t = useTranslations("exams");
  const tCommon = useTranslations("common");
  const invalidateBanks = useInvalidateModule(QUESTION_BANKS_QUERY_MODULE);

  const { error, isPending, confirm } = useConfirmAction({
    mutationFn: () => Services.questionBanks.deleteBank(record.id),
    onSuccess: () => {
      invalidateBanks();
      toast.success(t("questionBanks.removed"));
      onOpenChange(false);
      onDeleted?.();
    },
    fallbackMessage: tCommon("submitFailed"),
  });

  return (
    <ResponsiveAlertDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("questionBanks.delete.titleNamed", { name: record.name })}
      description={t("questionBanks.delete.description")}
      confirmLabel={t("questionBanks.actions.delete")}
      variant="destructive"
      isPending={isPending}
      error={error ?? undefined}
      onConfirm={confirm}
    />
  );
}
