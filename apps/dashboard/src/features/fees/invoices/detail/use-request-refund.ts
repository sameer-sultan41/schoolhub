"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { UseFormReturn } from "react-hook-form";

import { useFormDialogSubmit } from "@/hooks/use-form-dialog-submit";
import { useIdempotencyKey } from "@/hooks/use-idempotency-key";
import { useInvalidateModule } from "@/hooks/use-invalidate-module";
import { ApiError, Services, type RefundRecord } from "@/services";
import {
  REFUND_REQUEST_ERROR_FIELDS,
  REFUNDS_QUERY_MODULE,
} from "@/services/modules/refunds/refunds-constant";
import {
  buildRequestRefundInput,
  refundableRemainder,
} from "@/services/modules/refunds/refunds-helper";
import type { RequestRefundFormValues } from "@/services/modules/refunds/refunds.schema";

/**
 * Files the refund request. The `Idempotency-Key` stands for one request and lives for the
 * dialog's lifetime: a double submit or a retry after a lost response replays the first request
 * instead of filing two. It is dropped on success and whenever the form changes. An over-limit
 * refusal (a 422 under `amount`) carries what is still refundable in `meta`; it is kept as
 * `remainder` for the dialog to say, beside the server's own sentence under the amount.
 */
export function useRequestRefund(form: UseFormReturn<RequestRefundFormValues>, paymentId: string) {
  const tCommon = useTranslations("common");
  const invalidateRefunds = useInvalidateModule(REFUNDS_QUERY_MODULE);
  const idempotencyKey = useIdempotencyKey(form);
  const [remainder, setRemainder] = useState<string | null>(null);
  const [refund, setRefund] = useState<RefundRecord | null>(null);

  const submit = useFormDialogSubmit({
    form,
    mutationFn: async (values: RequestRefundFormValues) => {
      try {
        return await Services.refunds.createRefund(
          buildRequestRefundInput(paymentId, values),
          idempotencyKey.current(),
        );
      } catch (error) {
        if (error instanceof ApiError) setRemainder(refundableRemainder(error.meta));
        throw error;
      }
    },
    knownFields: REFUND_REQUEST_ERROR_FIELDS,
    onSuccess: (created) => {
      idempotencyKey.clear();
      setRemainder(null);
      setRefund(created);
      invalidateRefunds();
    },
    fallbackMessage: tCommon("submitFailed"),
  });

  return {
    handleSubmit: submit.handleSubmit,
    formError: submit.formError,
    isPending: submit.isPending,
    /** What is still refundable, once a request was refused for going over it. */
    remainder,
    /** The filed request: the dialog confirms it in place of the form. */
    refund,
  };
}
