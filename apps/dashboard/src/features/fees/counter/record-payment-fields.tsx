"use client";

import { useTranslations } from "next-intl";
import type { UseFormReturn } from "react-hook-form";
import { FormControl, FormField, FormItem, FormLabel, FormMessage, Input } from "@schoolhub/ui";

import { FormSelectField } from "@/components/form-select-field";
import { enumLabel } from "@/lib/enum-label";
import {
  COUNTER_PAYMENT_METHODS,
  PAYMENT_REFERENCE_MAX,
} from "@/services/modules/payments/payments-constant";
import { needsReference } from "@/services/modules/payments/payments-helper";
import type { RecordPaymentFormValues } from "@/services/modules/payments/payments.schema";
import { PAYMENT_METHOD_LABEL_KEY } from "@/features/fees/shared/payment-labels";

/** The record-payment inputs: amount, method (never the gateway) and the reference a cheque or
 * transfer needs. Every server field error shows under its input. */
export function RecordPaymentFields({ form }: { form: UseFormReturn<RecordPaymentFormValues> }) {
  const t = useTranslations("fees");
  const method = form.watch("method");
  const methods = COUNTER_PAYMENT_METHODS.map((id) => ({
    id,
    name: enumLabel(t, PAYMENT_METHOD_LABEL_KEY, id),
  }));

  return (
    <>
      <FormField
        control={form.control}
        name="amount"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t("counter.dialog.amount")}</FormLabel>
            <FormControl>
              <Input type="text" inputMode="decimal" autoComplete="off" {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormSelectField
        form={form}
        name="method"
        label={t("counter.dialog.method")}
        placeholder={t("counter.dialog.method")}
        options={methods}
      />
      <FormField
        control={form.control}
        name="reference_no"
        render={({ field }) => (
          <FormItem>
            <FormLabel>
              {t(
                needsReference(method)
                  ? "counter.dialog.referenceRequired"
                  : "counter.dialog.reference",
              )}
            </FormLabel>
            <FormControl>
              <Input maxLength={PAYMENT_REFERENCE_MAX} autoComplete="off" {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
    </>
  );
}
