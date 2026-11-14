"use client";

import { useMemo } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useLocale, useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { FormControl, FormField, FormItem, FormLabel, FormMessage, Input } from "@schoolhub/ui";

import { FormDialogLayout } from "@/components/form-dialog-layout";
import { FormSelectField } from "@/components/form-select-field";
import { useFormDialogSubmit } from "@/hooks/use-form-dialog-submit";
import { useIdempotencyKey } from "@/hooks/use-idempotency-key";
import { useInvalidateModule } from "@/hooks/use-invalidate-module";
import { enumLabel } from "@/lib/enum-label";
import { formatMoney } from "@/lib/format-decimal";
import { Services, type RefundRecord } from "@/services";
import { COUNTER_PAYMENT_METHODS } from "@/services/modules/payments/payments-constant";
import {
  REFUND_PROCESS_ERROR_FIELDS,
  REFUND_REFERENCE_MAX,
  REFUNDS_QUERY_MODULE,
} from "@/services/modules/refunds/refunds-constant";
import { buildProcessRefundInput } from "@/services/modules/refunds/refunds-helper";
import {
  createProcessRefundFormSchema,
  defaultProcessRefundFormValues,
  type ProcessRefundFormValues,
} from "@/services/modules/refunds/refunds.schema";
import { PAYMENT_METHOD_LABEL_KEY } from "@/features/fees/shared/payment-labels";

export interface ProcessRefundDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  refund: RefundRecord;
}

/**
 * Pays an approved refund out and reverses its ledger posting: how the money went back (never
 * the gateway) and its reference. One `Idempotency-Key` per dialog instance, held until the
 * server accepts and dropped when the form changes, so a double submit or a retry after a lost
 * response pays out once. A refusal (a refund that is no longer approved) stays inline.
 *
 * Mounting contract: the caller mounts this only while it is open, so every open is a fresh form
 * and a fresh key.
 */
export function ProcessRefundDialog({ open, onOpenChange, refund }: ProcessRefundDialogProps) {
  const t = useTranslations("fees");
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const invalidate = useInvalidateModule(REFUNDS_QUERY_MODULE);
  const amount = formatMoney(locale, refund.amount);

  const schema = useMemo(
    () => createProcessRefundFormSchema({ required: tCommon("requiredField") }),
    [tCommon],
  );
  const form = useForm<ProcessRefundFormValues>({
    resolver: zodResolver(schema),
    defaultValues: defaultProcessRefundFormValues(),
  });
  const idempotencyKey = useIdempotencyKey(form);

  const { handleSubmit, formError, isPending } = useFormDialogSubmit({
    form,
    mutationFn: (values: ProcessRefundFormValues) =>
      Services.refunds.processRefund(
        refund.id,
        buildProcessRefundInput(values),
        idempotencyKey.current(),
      ),
    knownFields: REFUND_PROCESS_ERROR_FIELDS,
    onSuccess: () => {
      idempotencyKey.clear();
      invalidate();
      toast.success(t("payments.refunds.process.done", { amount }));
      onOpenChange(false);
    },
    fallbackMessage: tCommon("submitFailed"),
  });

  return (
    <FormDialogLayout
      open={open}
      onOpenChange={onOpenChange}
      title={t("payments.refunds.process.title", { amount })}
      description={t("payments.refunds.process.intro")}
      form={form}
      onSubmit={handleSubmit}
      formError={formError}
      isPending={isPending}
      submittingLabel={tCommon("saving")}
      submitLabel={t("payments.refunds.process.submit")}
    >
      <FormSelectField
        form={form}
        name="method"
        label={t("payments.refunds.process.method")}
        placeholder={t("payments.refunds.process.method")}
        options={COUNTER_PAYMENT_METHODS.map((id) => ({
          id,
          name: enumLabel(t, PAYMENT_METHOD_LABEL_KEY, id),
        }))}
      />
      <FormField
        control={form.control}
        name="reference_no"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t("payments.refunds.process.reference")}</FormLabel>
            <FormControl>
              <Input maxLength={REFUND_REFERENCE_MAX} autoComplete="off" {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
    </FormDialogLayout>
  );
}
