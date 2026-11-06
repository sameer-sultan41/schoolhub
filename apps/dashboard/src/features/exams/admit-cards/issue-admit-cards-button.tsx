"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@schoolhub/ui";
import { FileStack } from "lucide-react";

import { useInvalidateModule } from "@/hooks/use-invalidate-module";
import { useJobPolling } from "@/hooks/use-job-polling";
import { NON_FIELD, resolveErrorMessage } from "@/lib/error-message";
import { ApiError, Services, type ExamRecord } from "@/services";
import {
  ADMIT_CARDS_JOB_MODULE,
  ADMIT_CARDS_QUERY_MODULE,
} from "@/services/modules/admit-cards/admit-cards-constant";
import { renderedCount } from "@/services/modules/admit-cards/admit-cards-helper";
import { guardRefusal } from "@/features/exams/guard-refusal";

/**
 * Issue admit cards: the server creates every missing card at once and answers `202` with a job
 * that renders their PDFs. The line beside the button is the server's own count of cards this run
 * added and cards that already existed (never a tally made here); the job's end reloads the list,
 * so each card's Download appears with its file. A re-run tops up, and never reinstates a revoked
 * card.
 *
 * One `Idempotency-Key` stands for one intent to issue: it is kept until the request is accepted,
 * so a retry after a lost response replays the first answer, and dropped once it is, so pressing
 * the button again later (after new admissions) is a new run. The caller shows this only once the
 * schedule is published (`isExamIssuable`) and to a holder of `exams.admit-card.issue`.
 */
export function IssueAdmitCardsButton({ exam }: { exam: ExamRecord }) {
  const t = useTranslations("exams");
  const tErrors = useTranslations("errors");
  const invalidateCards = useInvalidateModule(ADMIT_CARDS_QUERY_MODULE);
  const keyRef = useRef<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  // The job whose end was already acted on, so a re-render never reloads or toasts twice.
  const handledJobRef = useRef<string | null>(null);

  const issue = useMutation({
    mutationFn: () => {
      keyRef.current ??= crypto.randomUUID();
      const idempotencyKey = keyRef.current;
      return guardRefusal(
        () => Services.admitCards.issueAdmitCards(exam.id, idempotencyKey),
        invalidateCards,
      );
    },
    onSuccess: (accepted) => {
      keyRef.current = null;
      setJobId(accepted.jobId);
      setSummary(
        t("admitCards.issue.summary", { added: accepted.added, existing: accepted.existing }),
      );
      // The rows exist already; only their files wait for the job.
      invalidateCards();
    },
    onError: (error: unknown) => {
      toast.error(resolveErrorMessage(error, tErrors, t("admitCards.issue.failed"), NON_FIELD));
    },
  });

  const { job, isTimedOut, isError, error, resume } = useJobPolling(ADMIT_CARDS_JOB_MODULE, jobId, {
    onTimedOut: () => {
      toast.error(t("admitCards.issue.timedOut"));
    },
  });
  // The server refused the poll outright (not a blip that outlasted the retries): nothing to watch.
  const isPollRefused = isError && !(error instanceof ApiError && error.isTransient);
  const hasEnded = job?.status === "succeeded" || job?.status === "failed";
  const isWatching = jobId !== null && !hasEnded && !isPollRefused;
  const isStalled = isWatching && (isTimedOut || isError);

  useEffect(() => {
    if (!job || handledJobRef.current === job.id || !hasEnded) return;
    handledJobRef.current = job.id;
    invalidateCards();
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
  }, [job, hasEnded, invalidateCards, t]);

  const isBusy = issue.isPending || (isWatching && !isStalled);

  return (
    <div className="flex flex-wrap items-center justify-end gap-3">
      <p role="status" className="text-sm text-muted-foreground">
        {summary}
        {isWatching && !isStalled && (
          <span className="ms-2">
            {t("admitCards.issue.rendering", { progress: job?.progress ?? 0 })}
          </span>
        )}
      </p>
      <Button
        variant="primary"
        disabled={isBusy}
        onClick={() => {
          if (isStalled) resume();
          else issue.mutate();
        }}
      >
        <FileStack aria-hidden="true" />
        {t(isStalled ? "admitCards.issue.resume" : "admitCards.issue.button")}
      </Button>
    </div>
  );
}
