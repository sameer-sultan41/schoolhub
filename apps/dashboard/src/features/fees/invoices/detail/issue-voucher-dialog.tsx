"use client";

import { useMemo } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
} from "@schoolhub/ui";

import { FormDialogLayout } from "@/components/form-dialog-layout";
import { FormSelectField } from "@/components/form-select-field";
import { useFormDialogSubmit } from "@/hooks/use-form-dialog-submit";
import { useInvalidateModule } from "@/hooks/use-invalidate-module";
import { enumLabel } from "@/lib/enum-label";
import { Services, type FeeInvoiceRecord } from "@/services";
import {
  VOUCHER_ISSUE_ERROR_FIELDS,
  VOUCHER_PROVIDERS,
  VOUCHER_VALIDITY_DAYS_MAX,
  VOUCHERS_QUERY_MODULE,
} from "@/services/modules/vouchers/vouchers-constant";
import { buildIssueVoucherInput } from "@/services/modules/vouchers/vouchers-helper";
import {
  createIssueVoucherFormSchema,
  defaultIssueVoucherFormValues,
  type IssueVoucherFormValues,
} from "@/services/modules/vouchers/vouchers.schema";
import { VOUCHER_PROVIDER_LABEL_KEY } from "@/features/fees/shared/voucher-labels";

export interface IssueVoucherDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoice: FeeInvoiceRecord;
}

/**
 * Prints a bank slip for the invoice's balance: the provider and, optionally, how many days it
 * stays valid (blank keeps the school's default). The amount, consumer number and due date are
 * the server's. A refusal (a canceled or settled invoice) shows as the dialog's message; the
 * vouchers list reloads on success.
 *
 * Mounting contract: the caller mounts this only while it is open, so every open is a fresh form.
 */
export function IssueVoucherDialog({ open, onOpenChange, invoice }: IssueVoucherDialogProps) {
  const t = useTranslations("fees");
  const providerT = useTranslations("portal.fees");
  const tCommon = useTranslations("common");
  const invalidate = useInvalidateModule(VOUCHERS_QUERY_MODULE);

  const schema = useMemo(
    () =>
      createIssueVoucherFormSchema({
        required: tCommon("requiredField"),
        validity: t("invoices.voucherDialog.validityInvalid", { max: VOUCHER_VALIDITY_DAYS_MAX }),
      }),
    [t, tCommon],
  );
  const form = useForm<IssueVoucherFormValues>({
    resolver: zodResolver(schema),
    defaultValues: defaultIssueVoucherFormValues(),
  });

  const { handleSubmit, formError, isPending } = useFormDialogSubmit({
    form,
    mutationFn: (values: IssueVoucherFormValues) =>
      Services.vouchers.issueVoucher(invoice.id, buildIssueVoucherInput(values)),
    knownFields: VOUCHER_ISSUE_ERROR_FIELDS,
    onSuccess: (voucher) => {
      invalidate();
      toast.success(t("invoices.voucherDialog.done", { number: voucher.consumer_number }));
      onOpenChange(false);
    },
    fallbackMessage: tCommon("submitFailed"),
  });

  return (
    <FormDialogLayout
      open={open}
      onOpenChange={onOpenChange}
      title={t("invoices.voucherDialog.title", { number: invoice.invoice_no })}
      description={t("invoices.voucherDialog.intro")}
      form={form}
      onSubmit={handleSubmit}
      formError={formError}
      isPending={isPending}
      submittingLabel={tCommon("saving")}
      submitLabel={t("invoices.voucherDialog.submit")}
    >
      <FormSelectField
        form={form}
        name="provider"
        label={t("invoices.voucherDialog.provider")}
        placeholder={t("invoices.voucherDialog.provider")}
        options={VOUCHER_PROVIDERS.map((id) => ({
          id,
          name: enumLabel(providerT, VOUCHER_PROVIDER_LABEL_KEY, id),
        }))}
      />
      <FormField
        control={form.control}
        name="validity_days"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t("invoices.voucherDialog.validity")}</FormLabel>
            <FormControl>
              <Input type="text" inputMode="numeric" autoComplete="off" {...field} />
            </FormControl>
            <FormDescription>{t("invoices.voucherDialog.validityHint")}</FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />
    </FormDialogLayout>
  );
}
