"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { ResponsiveAlertDialog } from "@/components/responsive-alert-dialog";
import { useConfirmAction } from "@/hooks/use-confirm-action";
import { useInvalidateModule } from "@/hooks/use-invalidate-module";
import { EMPTY_VALUE } from "@/lib/constants";
import { Services, type QuestionRecord } from "@/services";
import { QUESTION_BANKS_QUERY_MODULE } from "@/services/modules/question-banks/question-banks-constant";
import { jsonToText } from "@/services/modules/question-banks/question-banks-helper";

export interface ApproveQuestionDialogProps {
  bankId: string;
  question: QuestionRecord;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

/**
 * The human gate on an AI draft (invariant 5): the approver reads the whole question, its
 * choices, answer key, marks and topic before papers can use it, and approval cannot be undone.
 * Nothing is sent until Confirm; a refusal shows inline and the dialog stays open.
 *
 * Mounting contract: the caller mounts this only while it is open, so every open starts with
 * no stale error.
 */
export function ApproveQuestionDialog({
  bankId,
  question,
  open,
  onOpenChange,
}: ApproveQuestionDialogProps) {
  const t = useTranslations("exams");
  const tCommon = useTranslations("common");
  const invalidateBanks = useInvalidateModule(QUESTION_BANKS_QUERY_MODULE);

  const { error, isPending, confirm } = useConfirmAction({
    mutationFn: () => Services.questionBanks.approveQuestion(bankId, question.id),
    onSuccess: () => {
      invalidateBanks();
      toast.success(t("questionBanks.questions.approvedToast"));
      onOpenChange(false);
    },
    fallbackMessage: tCommon("submitFailed"),
  });

  const choices = Array.isArray(question.options) ? question.options.map(jsonToText) : [];
  const answerKey = jsonToText(question.answer_key);

  return (
    <ResponsiveAlertDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("questionBanks.questions.approve.title")}
      description={t("questionBanks.questions.approve.description")}
      confirmLabel={t("questionBanks.questions.actions.approve")}
      isPending={isPending}
      error={error ?? undefined}
      onConfirm={confirm}
    >
      <dl className="max-h-[50vh] space-y-3 overflow-y-auto">
        <Detail label={t("questionBanks.questions.approve.question")}>
          <p className="whitespace-pre-wrap">{question.question_text}</p>
        </Detail>
        {choices.length > 0 && (
          <Detail label={t("questionBanks.questions.approve.choices")}>
            <ol className="list-decimal space-y-0.5 ps-5">
              {choices.map((choice, index) => (
                <li key={index}>{choice}</li>
              ))}
            </ol>
          </Detail>
        )}
        <Detail label={t("questionBanks.questions.approve.answerKey")}>
          <p className="whitespace-pre-wrap">{answerKey || EMPTY_VALUE}</p>
        </Detail>
        <div className="grid grid-cols-2 gap-3">
          <Detail label={t("questionBanks.questions.approve.marks")}>
            {question.default_marks ?? EMPTY_VALUE}
          </Detail>
          <Detail label={t("questionBanks.questions.approve.topic")}>
            {question.topic ?? EMPTY_VALUE}
          </Detail>
        </div>
      </dl>
    </ResponsiveAlertDialog>
  );
}
