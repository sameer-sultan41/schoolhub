"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { UseFormReturn } from "react-hook-form";

import { useFormDialogSubmit } from "@/hooks/use-form-dialog-submit";
import { useInvalidateModule } from "@/hooks/use-invalidate-module";
import { useJobPolling } from "@/hooks/use-job-polling";
import { ApiError, Services } from "@/services";
import {
  FEE_INVOICE_GENERATE_ERROR_FIELDS,
  FEE_INVOICES_JOB_MODULE,
  FEE_INVOICES_QUERY_MODULE,
} from "@/services/modules/fee-invoices/fee-invoices-constant";
import { buildGenerateInvoicesInput } from "@/services/modules/fee-invoices/fee-invoices-helper";
import type { GenerateInvoicesFormValues } from "@/services/modules/fee-invoices/fee-invoices.schema";

/**
 * Starts the generation (`202` + a job) and watches it to its end. The `Idempotency-Key` stands
 * for one intent: kept until the server accepts, so a retry after a lost response replays the
 * first answer; dropped on acceptance and whenever the form changes, because the same key with a
 * different body is a different request. The list reloads when the job is accepted and again when
 * it ends, so the new invoices show.
 */
export function useGenerateInvoices(form: UseFormReturn<GenerateInvoicesFormValues>) {
  const tCommon = useTranslations("common");
  const invalidateInvoices = useInvalidateModule(FEE_INVOICES_QUERY_MODULE);
  const keyRef = useRef<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  // The job whose end was already acted on, so a re-render never reloads twice.
  const handledJobRef = useRef<string | null>(null);

  useEffect(() => {
    const subscription = form.watch(() => {
      keyRef.current = null;
    });
    return () => {
      subscription.unsubscribe();
    };
  }, [form]);

  const submit = useFormDialogSubmit({
    form,
    mutationFn: (values: GenerateInvoicesFormValues) => {
      keyRef.current ??= crypto.randomUUID();
      return Services.feeInvoices.generateFeeInvoices(
        buildGenerateInvoicesInput(values),
        keyRef.current,
      );
    },
    knownFields: FEE_INVOICE_GENERATE_ERROR_FIELDS,
    onSuccess: (accepted) => {
      keyRef.current = null;
      setJobId(accepted.jobId);
      invalidateInvoices();
    },
    fallbackMessage: tCommon("submitFailed"),
  });

  const { job, isTimedOut, isError, error, resume } = useJobPolling(FEE_INVOICES_JOB_MODULE, jobId);
  const hasEnded = job?.status === "succeeded" || job?.status === "failed";
  // The server refused the poll outright (not a blip that outlasted the retries): nothing to watch.
  const isPollRefused = isError && !(error instanceof ApiError && error.isTransient);
  const isWatching = jobId !== null && !hasEnded && !isPollRefused;

  useEffect(() => {
    if (!job || handledJobRef.current === job.id || !hasEnded) return;
    handledJobRef.current = job.id;
    invalidateInvoices();
  }, [job, hasEnded, invalidateInvoices]);

  return {
    handleSubmit: submit.handleSubmit,
    formError: submit.formError,
    isPending: submit.isPending,
    /** A job exists: the dialog shows its progress or end in place of the form. */
    isStarted: jobId !== null,
    job: hasEnded ? job : undefined,
    progress: job?.progress ?? 0,
    isRunning: isWatching && !isTimedOut && !isError,
    isStalled: isWatching && (isTimedOut || isError),
    isPollRefused,
    resume,
    /** Back to the form for another run. */
    reset: () => {
      keyRef.current = null;
      setJobId(null);
    },
  };
}
