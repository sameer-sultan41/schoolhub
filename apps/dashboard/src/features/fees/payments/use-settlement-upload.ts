"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { UseFormReturn } from "react-hook-form";

import { useFormDialogSubmit } from "@/hooks/use-form-dialog-submit";
import { useIdempotencyKey } from "@/hooks/use-idempotency-key";
import { useInvalidateModule } from "@/hooks/use-invalidate-module";
import { useJobPolling } from "@/hooks/use-job-polling";
import { ApiError, Services } from "@/services";
import {
  SETTLEMENT_IMPORTS_JOB_MODULE,
  SETTLEMENT_IMPORTS_QUERY_MODULE,
  SETTLEMENT_UPLOAD_ERROR_FIELDS,
} from "@/services/modules/settlement-imports/settlement-imports-constant";
import type { SettlementUploadFormValues } from "@/services/modules/settlement-imports/settlement-imports.schema";
import { PAYMENTS_QUERY_MODULE } from "@/services/modules/payments/payments-constant";
import { FEE_INVOICES_QUERY_MODULE } from "@/services/modules/fee-invoices/fee-invoices-constant";
import { VOUCHERS_QUERY_MODULE } from "@/services/modules/vouchers/vouchers-constant";

/**
 * Uploads the settlement file (`202` + a job) and watches the job to its end. The
 * `Idempotency-Key` stands for one upload: held until the server accepts, so a retry after a lost
 * response replays the first job instead of reconciling the file twice, and dropped when the
 * provider or file changes (the server binds the key to the file's digest). The imports list
 * reloads on acceptance; when the job ends, the payments, vouchers and invoices it posted
 * against reload too.
 */
export function useSettlementUpload(form: UseFormReturn<SettlementUploadFormValues>) {
  const tCommon = useTranslations("common");
  const invalidateImports = useInvalidateModule(SETTLEMENT_IMPORTS_QUERY_MODULE);
  const invalidatePayments = useInvalidateModule(PAYMENTS_QUERY_MODULE);
  const invalidateVouchers = useInvalidateModule(VOUCHERS_QUERY_MODULE);
  const invalidateInvoices = useInvalidateModule(FEE_INVOICES_QUERY_MODULE);
  const idempotencyKey = useIdempotencyKey(form);
  const [jobId, setJobId] = useState<string | null>(null);
  // The job whose end was already acted on, so a re-render never reloads twice.
  const handledJobRef = useRef<string | null>(null);

  const submit = useFormDialogSubmit({
    form,
    mutationFn: (values: SettlementUploadFormValues) => {
      const { file, provider } = values;
      if (!file) throw new Error("no file");
      return Services.settlementImports.uploadSettlementImport(
        file,
        provider,
        idempotencyKey.current(),
      );
    },
    knownFields: SETTLEMENT_UPLOAD_ERROR_FIELDS,
    onSuccess: (accepted) => {
      idempotencyKey.clear();
      setJobId(accepted.jobId);
      invalidateImports();
    },
    fallbackMessage: tCommon("submitFailed"),
  });

  const { job, isTimedOut, isError, error, resume } = useJobPolling(
    SETTLEMENT_IMPORTS_JOB_MODULE,
    jobId,
  );
  const hasEnded = job?.status === "succeeded" || job?.status === "failed";
  // The server refused the poll outright (not a blip that outlasted the retries): nothing to watch.
  const isPollRefused = isError && !(error instanceof ApiError && error.isTransient);
  const isWatching = jobId !== null && !hasEnded && !isPollRefused;

  useEffect(() => {
    if (!job || handledJobRef.current === job.id || !hasEnded) return;
    handledJobRef.current = job.id;
    invalidateImports();
    invalidatePayments();
    invalidateVouchers();
    invalidateInvoices();
  }, [
    job,
    hasEnded,
    invalidateImports,
    invalidatePayments,
    invalidateVouchers,
    invalidateInvoices,
  ]);

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
  };
}
