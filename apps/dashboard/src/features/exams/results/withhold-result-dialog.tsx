"use client";

import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { useInvalidateModule } from "@/hooks/use-invalidate-module";
import { Services, type ResultRecord } from "@/services";
import {
  RESULTS_QUERY_MODULE,
  WITHHOLD_REASON_MAX_LENGTH,
} from "@/services/modules/exam-results/exam-results-constant";
import { guardRefusal } from "@/features/exams/guard-refusal";
import { ReasonDialog } from "./reason-dialog";

export interface WithholdResultDialogProps {
  onOpenChange: (open: boolean) => void;
  /** A result not yet published or withheld. */
  result: ResultRecord;
}

/**
 * Withholds one student's result from publication, with a reason (§5.6). Publishing then skips it
 * and counts it as withheld, and re-processing keeps it withheld. A result published meanwhile (a
 * 409) reloads the list and keeps the server's sentence.
 *
 * Mounting contract: the caller mounts this only while it is open.
 */
export function WithholdResultDialog({ onOpenChange, result }: WithholdResultDialogProps) {
  const t = useTranslations("exams");
  const invalidateResults = useInvalidateModule(RESULTS_QUERY_MODULE);
  const name = { name: result.student_name };

  return (
    <ReasonDialog
      onOpenChange={onOpenChange}
      maxLength={WITHHOLD_REASON_MAX_LENGTH}
      copy={{
        title: t("results.withhold.title", name),
        description: t("results.withhold.description"),
        hint: t("results.withhold.hint"),
        submit: t("results.withhold.submit"),
        submitting: t("results.withhold.submitting"),
      }}
      submit={(reason) =>
        guardRefusal(
          () => Services.examResults.withholdResult(result.id, reason),
          invalidateResults,
        )
      }
      onDone={() => {
        invalidateResults();
        toast.success(t("results.withhold.done", name));
      }}
    />
  );
}
