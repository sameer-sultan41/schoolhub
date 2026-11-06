"use client";

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@schoolhub/ui";
import { FileStack, Send } from "lucide-react";

import { ResponsiveAlertDialog } from "@/components/responsive-alert-dialog";
import { useConfirmAction } from "@/hooks/use-confirm-action";
import { useCurrentUser } from "@/hooks/use-current-user";
import { useInvalidateModule } from "@/hooks/use-invalidate-module";
import { NON_FIELD, resolveErrorMessage } from "@/lib/error-message";
import { hasPermission } from "@/lib/permissions";
import { Services, type ExamRecord } from "@/services";
import type { BackgroundJobRecord } from "@/services/modules/jobs/jobs-service";
import { renderedCount } from "@/services/modules/admit-cards/admit-cards-helper";
import {
  REPORT_CARDS_EXAM_STATUS,
  REPORT_CARDS_JOB_MODULE,
  REPORT_CARDS_QUERY_MODULE,
} from "@/services/modules/report-cards/report-cards-constant";
import { failedRenderCount } from "@/services/modules/report-cards/report-cards-helper";
import { guardRefusal } from "@/features/exams/guard-refusal";
import { useExamJob } from "@/features/exams/use-exam-job";

/** Publishes every rendered card (`exams.report-card.publish`) and reports the server's count.
 * Mounting contract: mounted only while open. */
function PublishReportCardsDialog({
  exam,
  onOpenChange,
}: {
  exam: ExamRecord;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("exams");
  const tCommon = useTranslations("common");
  const invalidateCards = useInvalidateModule(REPORT_CARDS_QUERY_MODULE);

  const { error, isPending, confirm } = useConfirmAction({
    mutationFn: () =>
      guardRefusal(() => Services.reportCards.publishReportCards(exam.id), invalidateCards),
    onSuccess: (outcome) => {
      invalidateCards();
      toast.success(t("reportCards.publish.done", { count: outcome.published }));
      onOpenChange(false);
    },
    fallbackMessage: tCommon("submitFailed"),
  });

  return (
    <ResponsiveAlertDialog
      open
      onOpenChange={onOpenChange}
      title={t("reportCards.publish.title")}
      description={t("reportCards.publish.description")}
      confirmLabel={t("reportCards.publish.confirm")}
      isPending={isPending}
      error={error ?? undefined}
      onConfirm={confirm}
    />
  );
}

/**
 * Generate report cards (`exams.report-card.create`, `202` + a render job) and Publish report
 * cards (`.publish`), both once the exam's results are published (§11). A re-run versions a
 * published card and keeps every remark; the job's end reloads the list, so Download appears.
 */
export function ReportCardActions({ exam }: { exam: ExamRecord }) {
  const t = useTranslations("exams");
  const tErrors = useTranslations("errors");
  const { data: user } = useCurrentUser();
  const invalidateCards = useInvalidateModule(REPORT_CARDS_QUERY_MODULE);
  const [publishing, setPublishing] = useState(false);
  const isReady = exam.status === REPORT_CARDS_EXAM_STATUS;
  const canGenerate = isReady && hasPermission(user, "exams.report-card.create");
  const canPublish = isReady && hasPermission(user, "exams.report-card.publish");

  const onEnded = useCallback(
    (job: BackgroundJobRecord) => {
      const failed = failedRenderCount(job.result);
      if (job.status === "succeeded" && failed > 0) {
        // A partial render: some cards are ready, the rest stay drafts until a re-run.
        toast.warning(
          t("reportCards.generate.partial", { rendered: renderedCount(job.result) ?? 0, failed }),
        );
      } else if (job.status === "succeeded") {
        const count = renderedCount(job.result);
        toast.success(
          count === null
            ? t("reportCards.generate.doneAll")
            : t("reportCards.generate.done", { count }),
        );
      } else {
        toast.error(job.error ?? t("reportCards.generate.jobFailed"));
      }
    },
    [t],
  );

  const job = useExamJob({
    jobModule: REPORT_CARDS_JOB_MODULE,
    start: (idempotencyKey) =>
      guardRefusal(
        () => Services.reportCards.generateReportCards(exam.id, idempotencyKey),
        invalidateCards,
      ),
    onSettled: invalidateCards,
    onEnded,
    onStartError: (error) => {
      toast.error(resolveErrorMessage(error, tErrors, t("reportCards.generate.failed"), NON_FIELD));
    },
    onTimedOut: () => {
      toast.error(t("reportCards.generate.timedOut"));
    },
  });

  if (!canGenerate && !canPublish) return null;

  return (
    <div className="flex flex-wrap items-center justify-end gap-3">
      {job.isRunning && (
        <p role="status" className="text-sm text-muted-foreground">
          {t("reportCards.generate.running", { progress: job.progress })}
        </p>
      )}
      {canGenerate && (
        <Button
          variant="outline"
          disabled={job.isBusy}
          onClick={() => {
            if (job.isStalled) job.resume();
            else job.run();
          }}
        >
          <FileStack aria-hidden="true" />
          {t(job.isStalled ? "reportCards.generate.resume" : "reportCards.generate.button")}
        </Button>
      )}
      {canPublish && (
        <Button
          variant="primary"
          disabled={job.isBusy}
          onClick={() => {
            setPublishing(true);
          }}
        >
          <Send aria-hidden="true" />
          {t("reportCards.publish.button")}
        </Button>
      )}
      {publishing && <PublishReportCardsDialog exam={exam} onOpenChange={setPublishing} />}
    </div>
  );
}
