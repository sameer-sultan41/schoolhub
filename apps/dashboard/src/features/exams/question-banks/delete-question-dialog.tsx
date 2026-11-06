"use client";

import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { ResponsiveAlertDialog } from "@/components/responsive-alert-dialog";
import { useConfirmAction } from "@/hooks/use-confirm-action";
import { useInvalidateModule } from "@/hooks/use-invalidate-module";
import { Services, type QuestionRecord } from "@/services";
import { QUESTION_BANKS_QUERY_MODULE } from "@/services/modules/question-banks/question-banks-constant";

export interface DeleteQuestionDialogProps {
  bankId: string;
  question: QuestionRecord;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Removes one question from its bank. Papers already downloaded keep it; the bank's later papers
 * cannot use it. A refusal shows inline and the dialog stays open.
 *
 * Mounting contract: the caller mounts this only while it is open, so every open starts with
 * no stale error.
 */
export function DeleteQuestionDialog({
  bankId,
  question,
  open,
  onOpenChange,
}: DeleteQuestionDialogProps) {
  const t = useTranslations("exams");
  const tCommon = useTranslations("common");
  const invalidateBanks = useInvalidateModule(QUESTION_BANKS_QUERY_MODULE);

  const { error, isPending, confirm } = useConfirmAction({
    mutationFn: () => Services.questionBanks.deleteQuestion(bankId, question.id),
    onSuccess: () => {
      invalidateBanks();
      toast.success(t("questionBanks.questions.removed"));
      onOpenChange(false);
    },
    fallbackMessage: tCommon("submitFailed"),
  });

  return (
    <ResponsiveAlertDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("questionBanks.questions.delete.title")}
      description={t("questionBanks.questions.delete.description", {
        question: question.question_text,
      })}
      confirmLabel={t("questionBanks.questions.actions.delete")}
      variant="destructive"
      isPending={isPending}
      error={error ?? undefined}
      onConfirm={confirm}
    />
  );
}
