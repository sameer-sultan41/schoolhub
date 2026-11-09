"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { UseFormReturn } from "react-hook-form";

import { useFormDialogSubmit } from "@/hooks/use-form-dialog-submit";
import { useInvalidateModule } from "@/hooks/use-invalidate-module";
import { Services } from "@/services";
import { FEE_INVOICES_QUERY_MODULE } from "@/services/modules/fee-invoices/fee-invoices-constant";
import {
  PAYMENTS_QUERY_MODULE,
  RECORD_PAYMENT_ERROR_FIELDS,
} from "@/services/modules/payments/payments-constant";
import { buildRecordPaymentInput } from "@/services/modules/payments/payments-helper";
import type { RecordPaymentFormValues } from "@/services/modules/payments/payments.schema";
import type { PaymentRecord } from "@/services/modules/payments/payments-type";

/**
 * Records the payment. The `Idempotency-Key` stands for one intent and lives in a ref, so a
 * double submit or a retry after a lost response replays the first payment instead of taking the
 * money twice. It is dropped on success and whenever the form changes: the server refuses the
 * same key with a different body, and a changed amount is a different payment. A server refusal
 * stores nothing, so a corrected resubmit is safe either way. The invoices and payments lists
 * reload on success, so the balance shown is the server's new one.
 */
export function useRecordPayment(form: UseFormReturn<RecordPaymentFormValues>, invoiceId: string) {
  const tCommon = useTranslations("common");
  const invalidateInvoices = useInvalidateModule(FEE_INVOICES_QUERY_MODULE);
  const invalidatePayments = useInvalidateModule(PAYMENTS_QUERY_MODULE);
  const keyRef = useRef<string | null>(null);
  const [payment, setPayment] = useState<PaymentRecord | null>(null);

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
    mutationFn: (values: RecordPaymentFormValues) => {
      keyRef.current ??= crypto.randomUUID();
      return Services.payments.recordPayment(
        buildRecordPaymentInput(invoiceId, values),
        keyRef.current,
      );
    },
    knownFields: RECORD_PAYMENT_ERROR_FIELDS,
    onSuccess: (recorded) => {
      keyRef.current = null;
      setPayment(recorded);
      invalidateInvoices();
      invalidatePayments();
    },
    fallbackMessage: tCommon("submitFailed"),
  });

  return {
    handleSubmit: submit.handleSubmit,
    formError: submit.formError,
    isPending: submit.isPending,
    /** The recorded payment: the dialog shows its receipt in place of the form. */
    payment,
  };
}
