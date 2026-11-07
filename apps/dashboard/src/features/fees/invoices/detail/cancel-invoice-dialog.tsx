"use client";

import { useMemo } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { FormControl, FormField, FormItem, FormLabel, FormMessage, Textarea } from "@schoolhub/ui";

import { FormDialogLayout } from "@/components/form-dialog-layout";
import { useFormDialogSubmit } from "@/hooks/use-form-dialog-submit";
import { useInvalidateModule } from "@/hooks/use-invalidate-module";
import { Services, type FeeInvoiceRecord } from "@/services";
import {
  FEE_INVOICE_CANCEL_ERROR_FIELDS,
  FEE_INVOICE_REASON_MAX,
  FEE_INVOICES_QUERY_MODULE,
} from "@/services/modules/fee-invoices/fee-invoices-constant";
import { defaultCancelInvoiceFormValues } from "@/services/modules/fee-invoices/fee-invoices-helper";
import {
  createCancelInvoiceFormSchema,
  type CancelInvoiceFormValues,
} from "@/services/modules/fee-invoices/fee-invoices.schema";

export interface CancelInvoiceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoice: FeeInvoiceRecord;
}

/**
 * Cancels an invoice with a required reason (`:cancel`). The server's refusal (422: money already
 * paid, or already canceled) shows inline above the reason and the dialog stays open; a refusal
 * on `reason` shows under it. The invoice and the lists reload on success.
 *
 * Mounting contract: the caller mounts this only while it is open, so every open is a fresh form.
 */
export function CancelInvoiceDialog({ open, onOpenChange, invoice }: CancelInvoiceDialogProps) {
  const t = useTranslations("fees");
  const tCommon = useTranslations("common");
  const invalidateInvoices = useInvalidateModule(FEE_INVOICES_QUERY_MODULE);

  const schema = useMemo(
    () => createCancelInvoiceFormSchema({ required: tCommon("requiredField") }),
    [tCommon],
  );
  const form = useForm<CancelInvoiceFormValues>({
    resolver: zodResolver(schema),
    defaultValues: defaultCancelInvoiceFormValues(),
  });

  const { handleSubmit, formError, isPending } = useFormDialogSubmit({
    form,
    mutationFn: (values: CancelInvoiceFormValues) =>
      Services.feeInvoices.cancelFeeInvoice(invoice.id, values.reason.trim()),
    knownFields: FEE_INVOICE_CANCEL_ERROR_FIELDS,
    onSuccess: () => {
      invalidateInvoices();
      toast.success(t("invoices.cancel.done", { number: invoice.invoice_no }));
      onOpenChange(false);
    },
    fallbackMessage: tCommon("submitFailed"),
  });

  return (
    <FormDialogLayout
      open={open}
      onOpenChange={onOpenChange}
      title={t("invoices.cancel.title", { number: invoice.invoice_no })}
      description={t("invoices.cancel.intro")}
      form={form}
      onSubmit={handleSubmit}
      formError={formError}
      isPending={isPending}
      submittingLabel={tCommon("saving")}
      submitLabel={t("invoices.cancel.submit")}
    >
      <FormField
        control={form.control}
        name="reason"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t("invoices.cancel.reason")}</FormLabel>
            <FormControl>
              <Textarea rows={3} maxLength={FEE_INVOICE_REASON_MAX} {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
    </FormDialogLayout>
  );
}
