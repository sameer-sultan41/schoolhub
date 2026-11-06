"use client";

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@schoolhub/ui";
import { FileStack } from "lucide-react";

import { useInvalidateModule } from "@/hooks/use-invalidate-module";
import { NON_FIELD, resolveErrorMessage } from "@/lib/error-message";
import { Services, type ExamRecord } from "@/services";
import type { BackgroundJobRecord } from "@/services/modules/jobs/jobs-service";
import {
  ADMIT_CARDS_JOB_MODULE,
  ADMIT_CARDS_QUERY_MODULE,
} from "@/services/modules/admit-cards/admit-cards-constant";
import { renderedCount } from "@/services/modules/admit-cards/admit-cards-helper";
import { guardRefusal } from "@/features/exams/guard-refusal";
import { useExamJob } from "@/features/exams/use-exam-job";

/**
 * Issue admit cards: the server creates every missing card at once and answers `202` with a job
 * that renders their PDFs. The line beside the button is the server's own count of cards this run
 * added and cards that already existed (never a tally made here); the job's end reloads the list,
 * so each card's Download appears with its file. A re-run tops up, and never reinstates a revoked
 * card. The key, poll and end report are `useExamJob`'s. The caller shows this only once the
 * schedule is published (`isExamIssuable`) and to a holder of `exams.admit-card.issue`.
 */
export function IssueAdmitCardsButton({ exam }: { exam: ExamRecord }) {
  const t = useTranslations("exams");
  const tErrors = useTranslations("errors");
  const invalidateCards = useInvalidateModule(ADMIT_CARDS_QUERY_MODULE);
  const [summary, setSummary] = useState<string | null>(null);

  const onEnded = useCallback(
    (job: BackgroundJobRecord) => {
      if (job.status === "succeeded") {
        const count = renderedCount(job.result);
        toast.success(
          count === null
            ? t("admitCards.issue.renderedAll")
            : t("admitCards.issue.rendered", { count }),
        );
      } else {
        toast.error(job.error ?? t("admitCards.issue.renderFailed"));
      }
    },
    [t],
  );

  const job = useExamJob({
    jobModule: ADMIT_CARDS_JOB_MODULE,
    start: (idempotencyKey) =>
      guardRefusal(
        () => Services.admitCards.issueAdmitCards(exam.id, idempotencyKey),
        invalidateCards,
      ),
    // The rows exist already; only their files wait for the job.
    onAccepted: (accepted) => {
      setSummary(
        t("admitCards.issue.summary", { added: accepted.added, existing: accepted.existing }),
      );
    },
    onSettled: invalidateCards,
    onEnded,
    onStartError: (error) => {
      toast.error(resolveErrorMessage(error, tErrors, t("admitCards.issue.failed"), NON_FIELD));
    },
    onTimedOut: () => {
      toast.error(t("admitCards.issue.timedOut"));
    },
  });

  return (
    <div className="flex flex-wrap items-center justify-end gap-3">
      <p role="status" className="text-sm text-muted-foreground">
        {summary}
        {job.isRunning && (
          <span className="ms-2">
            {t("admitCards.issue.rendering", { progress: job.progress })}
          </span>
        )}
      </p>
      <Button
        variant="primary"
        disabled={job.isBusy}
        onClick={() => {
          if (job.isStalled) job.resume();
          else job.run();
        }}
      >
        <FileStack aria-hidden="true" />
        {t(job.isStalled ? "admitCards.issue.resume" : "admitCards.issue.button")}
      </Button>
    </div>
  );
}
