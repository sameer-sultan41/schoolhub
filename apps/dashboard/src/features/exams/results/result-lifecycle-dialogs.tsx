"use client";

import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { ResponsiveAlertDialog } from "@/components/responsive-alert-dialog";
import { useConfirmAction } from "@/hooks/use-confirm-action";
import { useInvalidateModule } from "@/hooks/use-invalidate-module";
import { Services, type ExamRecord } from "@/services";
import {
  RESULTS_QUERY_MODULE,
  SEND_BACK_REASON_MAX_LENGTH,
} from "@/services/modules/exam-results/exam-results-constant";
import { guardRefusal } from "@/features/exams/guard-refusal";
import { ReasonDialog } from "./reason-dialog";

/** The results lifecycle's dialogs. Each is mounted by the bar only while open, so every open
 * starts with no stale error. */
export interface LifecycleDialogProps {
  exam: ExamRecord;
  onOpenChange: (open: boolean) => void;
}

/**
 * Approves every pending result (`exams.result.approve`). The bar holds it for the latest
 * processor; a forced request still gets the server's 422 ("You ran the processing…"), shown here.
 */
export function ApproveResultsDialog({ exam, onOpenChange }: LifecycleDialogProps) {
  const t = useTranslations("exams");
  const tCommon = useTranslations("common");
  const invalidateResults = useInvalidateModule(RESULTS_QUERY_MODULE);

  const { error, isPending, confirm } = useConfirmAction({
    mutationFn: () =>
      guardRefusal(() => Services.examResults.approveResults(exam.id), invalidateResults),
    onSuccess: (outcome) => {
      invalidateResults();
      toast.success(t("results.approve.done", { count: outcome.approved }));
      onOpenChange(false);
    },
    fallbackMessage: tCommon("submitFailed"),
  });

  return (
    <ResponsiveAlertDialog
      open
      onOpenChange={onOpenChange}
      title={t("results.approve.title")}
      description={t("results.approve.description")}
      confirmLabel={t("results.approve.confirm")}
      isPending={isPending}
      error={error ?? undefined}
      onConfirm={confirm}
    />
  );
}

/** Publishes the approved results (`exams.result.publish`) and reports the server's counts of
 * results published and withheld: a withheld result is never published. */
export function PublishResultsDialog({ exam, onOpenChange }: LifecycleDialogProps) {
  const t = useTranslations("exams");
  const tCommon = useTranslations("common");
  const invalidateResults = useInvalidateModule(RESULTS_QUERY_MODULE);

  const { error, isPending, confirm } = useConfirmAction({
    mutationFn: () =>
      guardRefusal(() => Services.examResults.publishResults(exam.id), invalidateResults),
    onSuccess: (outcome) => {
      invalidateResults();
      toast.success(
        t("results.publish.done", { published: outcome.published, withheld: outcome.withheld }),
      );
      onOpenChange(false);
    },
    fallbackMessage: tCommon("submitFailed"),
  });

  return (
    <ResponsiveAlertDialog
      open
      onOpenChange={onOpenChange}
      title={t("results.publish.title")}
      description={t("results.publish.description")}
      confirmLabel={t("results.publish.confirm")}
      isPending={isPending}
      error={error ?? undefined}
      onConfirm={confirm}
    />
  );
}

/** Sends the results back to marks entry with a reason (`exams.result.approve`); reprocessing then
 * re-stamps the processor, so whoever runs it next may not approve it. */
export function SendBackResultsDialog({ exam, onOpenChange }: LifecycleDialogProps) {
  const t = useTranslations("exams");
  const invalidateResults = useInvalidateModule(RESULTS_QUERY_MODULE);

  return (
    <ReasonDialog
      onOpenChange={onOpenChange}
      maxLength={SEND_BACK_REASON_MAX_LENGTH}
      copy={{
        title: t("results.sendBack.title"),
        description: t("results.sendBack.description"),
        hint: t("results.sendBack.hint"),
        submit: t("results.sendBack.submit"),
        submitting: t("results.sendBack.submitting"),
      }}
      submit={(reason) =>
        guardRefusal(() => Services.examResults.sendResultsBack(exam.id, reason), invalidateResults)
      }
      onDone={(outcome) => {
        invalidateResults();
        toast.success(t("results.sendBack.done", { count: outcome.reopened }));
      }}
    />
  );
}
