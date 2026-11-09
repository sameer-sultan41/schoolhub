"use client";

import { useMemo } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useLocale, useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { Alert, Button, Form } from "@schoolhub/ui";

import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/responsive-dialog";
import { formatMoney } from "@/lib/format-decimal";
import type { FeeInvoiceRecord } from "@/services";
import { defaultRecordPaymentFormValues } from "@/services/modules/payments/payments-helper";
import {
  createRecordPaymentFormSchema,
  type RecordPaymentFormValues,
} from "@/services/modules/payments/payments.schema";
import { PaymentReceiptPanel } from "./payment-receipt-panel";
import { RecordPaymentFields } from "./record-payment-fields";
import { useRecordPayment } from "./use-record-payment";

export interface RecordPaymentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoice: FeeInvoiceRecord;
}

/**
 * Takes money against one invoice. The amount starts at the server's `balance_due`; the method
 * excludes the gateway; a cheque or transfer needs its reference. One `Idempotency-Key` per
 * dialog instance (`useRecordPayment`), so a double submit or a retry after a network error takes
 * the money once. The server's refusals stay inline: over the balance under the amount, a
 * canceled invoice as the form's message. On success the form gives way to the receipt panel.
 *
 * Mounting contract: the caller mounts this only while it is open, so every open is a fresh form
 * and a fresh key.
 */
export function RecordPaymentDialog({ open, onOpenChange, invoice }: RecordPaymentDialogProps) {
  const t = useTranslations("fees");
  const tCommon = useTranslations("common");
  const locale = useLocale();

  const schema = useMemo(
    () =>
      createRecordPaymentFormSchema({
        required: tCommon("requiredField"),
        positive: t("counter.dialog.positive"),
        reference: t("counter.dialog.referenceMissing"),
      }),
    [t, tCommon],
  );
  const form = useForm<RecordPaymentFormValues>({
    resolver: zodResolver(schema),
    defaultValues: defaultRecordPaymentFormValues(invoice.balance_due),
  });
  const record = useRecordPayment(form, invoice.id);

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="max-w-lg" closeLabel={tCommon("close")}>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>
            {t("counter.dialog.title", { number: invoice.invoice_no })}
          </ResponsiveDialogTitle>
        </ResponsiveDialogHeader>
        <Form {...form}>
          <form noValidate onSubmit={record.handleSubmit}>
            <ResponsiveDialogBody className="max-h-[65vh] space-y-4 overflow-y-auto pe-1">
              {record.payment ? (
                <PaymentReceiptPanel payment={record.payment} />
              ) : (
                <>
                  <p className="text-sm text-muted-foreground">
                    {t("counter.dialog.balance", {
                      student: invoice.student_name,
                      amount: formatMoney(locale, invoice.balance_due),
                    })}
                  </p>
                  {record.formError && <Alert variant="destructive">{record.formError}</Alert>}
                  <RecordPaymentFields form={form} />
                </>
              )}
            </ResponsiveDialogBody>
            <ResponsiveDialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  onOpenChange(false);
                }}
              >
                {record.payment ? t("counter.receipt.done") : tCommon("cancel")}
              </Button>
              {!record.payment && (
                <Button type="submit" isLoading={record.isPending} loadingLabel={tCommon("saving")}>
                  {t("counter.dialog.submit")}
                </Button>
              )}
            </ResponsiveDialogFooter>
          </form>
        </Form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
