"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Alert, AlertDescription, Button } from "@schoolhub/ui";
import { Calculator } from "lucide-react";

import { examPath } from "@/config/paths";
import { useInvalidateModule } from "@/hooks/use-invalidate-module";
import { HTTP_STATUS_CONFLICT } from "@/lib/constants";
import { NON_FIELD, resolveErrorMessage } from "@/lib/error-message";
import { ApiError, Services, type ExamRecord } from "@/services";
import type { BackgroundJobRecord } from "@/services/modules/jobs/jobs-service";
import {
  MARKS_OUTSTANDING_CODE,
  RESULTS_JOB_MODULE,
  RESULTS_QUERY_MODULE,
} from "@/services/modules/exam-results/exam-results-constant";
import { processedCount } from "@/services/modules/exam-results/exam-results-helper";
import { EXAM_TAB_URL_KEY } from "@/services/modules/exams/exams-constant";
import { MARKS_TAB_ID } from "@/services/modules/marks/marks-constant";
import { guardRefusal } from "@/features/exams/guard-refusal";
import { useExamJob } from "@/features/exams/use-exam-job";

/**
 * Process results (`exams.result.create`): `202` + a job that computes every student's totals,
 * grade, GPA, rank and outcome and puts them in front of an approver. Re-running before approval
 * recomputes in place and keeps a withheld result withheld. The server refuses (409) while marks
 * are outstanding (`marks_outstanding`), naming the subjects; that sentence shows here with a way
 * to the Marks tab. Any other 409 shows its sentence alone.
 */
export function ProcessResultsButton({ exam }: { exam: ExamRecord }) {
  const t = useTranslations("exams");
  const tErrors = useTranslations("errors");
  const invalidateResults = useInvalidateModule(RESULTS_QUERY_MODULE);
  const [refusal, setRefusal] = useState<{ message: string; toMarks: boolean } | null>(null);

  const onEnded = useCallback(
    (job: BackgroundJobRecord) => {
      if (job.status === "succeeded") {
        const count = processedCount(job.result);
        toast.success(
          count === null ? t("results.process.doneAll") : t("results.process.done", { count }),
        );
      } else {
        toast.error(job.error ?? t("results.process.jobFailed"));
      }
    },
    [t],
  );

  const job = useExamJob({
    jobModule: RESULTS_JOB_MODULE,
    start: (idempotencyKey) => {
      setRefusal(null);
      return guardRefusal(
        () => Services.examResults.processResults(exam.id, idempotencyKey),
        invalidateResults,
      );
    },
    onSettled: invalidateResults,
    onEnded,
    onStartError: (error) => {
      // A 409 is the exam's own state (marks outstanding, or approved meanwhile): keep its
      // sentence, and point at marks entry only when that is what it is about.
      if (error instanceof ApiError && error.status === HTTP_STATUS_CONFLICT) {
        setRefusal({ message: error.message, toMarks: error.code === MARKS_OUTSTANDING_CODE });
        return;
      }
      toast.error(resolveErrorMessage(error, tErrors, t("results.process.failed"), NON_FIELD));
    },
    onTimedOut: () => {
      toast.error(t("results.process.timedOut"));
    },
  });

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap items-center justify-end gap-3">
        {job.isRunning && (
          <p role="status" className="text-sm text-muted-foreground">
            {t("results.process.running", { progress: job.progress })}
          </p>
        )}
        <Button
          variant="primary"
          disabled={job.isBusy}
          onClick={() => {
            if (job.isStalled) job.resume();
            else job.run();
          }}
        >
          <Calculator aria-hidden="true" />
          {t(job.isStalled ? "results.process.resume" : "results.process.button")}
        </Button>
      </div>
      {refusal !== null && (
        <Alert variant="destructive" appearance="light" className="w-full">
          <AlertDescription className="flex flex-wrap items-center gap-2">
            <span>{refusal.message}</span>
            {refusal.toMarks && (
              <Link
                href={`${examPath(exam.id)}?${EXAM_TAB_URL_KEY}=${MARKS_TAB_ID}`}
                className="font-medium underline"
              >
                {t("results.process.toMarks")}
              </Link>
            )}
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
