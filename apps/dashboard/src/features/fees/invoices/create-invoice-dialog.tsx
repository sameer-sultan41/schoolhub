"use client";

import { useMemo, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { format } from "date-fns";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { FormControl, FormField, FormItem, FormLabel, FormMessage, Input } from "@schoolhub/ui";

import { FormDialogLayout } from "@/components/form-dialog-layout";
import { FormSelectField } from "@/components/form-select-field";
import { useFormDialogSubmit } from "@/hooks/use-form-dialog-submit";
import { useInvalidateModule } from "@/hooks/use-invalidate-module";
import { Services } from "@/services";
import {
  FEE_INVOICE_CREATE_ERROR_FIELDS,
  FEE_INVOICE_PERIOD_LABEL_MAX,
  FEE_INVOICES_QUERY_MODULE,
} from "@/services/modules/fee-invoices/fee-invoices-constant";
import {
  createFeeInvoiceFormSchema,
  type FeeInvoiceFormValues,
} from "@/services/modules/fee-invoices/fee-invoices.schema";
// The one student picker there is today; PR C hoists it out of `communication` for both users.
import {
  StudentPicker,
  type PickedStudent,
} from "@/features/communication/messages/student-picker";
import { useInvoiceReferences } from "@/features/fees/shared/use-invoice-references";

export interface CreateInvoiceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Raises one student's ad-hoc invoice (`POST /fee-invoices`, `fees.invoice.create`). The API takes
 * the header only (student, session, dates, an optional period label): the invoice starts as a
 * zero-total draft with no lines, which the dialog says. A server error that names a field shows
 * under it, any other as the form's message.
 *
 * Mounting contract: the caller mounts this only while it is open, so every open is a fresh form.
 */
export function CreateInvoiceDialog({ open, onOpenChange }: CreateInvoiceDialogProps) {
  const t = useTranslations("fees");
  const tCommon = useTranslations("common");
  const invalidateInvoices = useInvalidateModule(FEE_INVOICES_QUERY_MODULE);
  const references = useInvoiceReferences();
  const [student, setStudent] = useState<PickedStudent | null>(null);

  const schema = useMemo(
    () =>
      createFeeInvoiceFormSchema({
        required: tCommon("requiredField"),
        dueBeforeIssue: t("invoices.create.dueBeforeIssue"),
      }),
    [t, tCommon],
  );
  const form = useForm<FeeInvoiceFormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      student: "",
      academic_session: "",
      issue_date: format(new Date(), "yyyy-MM-dd"),
      due_date: "",
      period_label: "",
    },
  });

  const { handleSubmit, formError, isPending } = useFormDialogSubmit({
    form,
    mutationFn: (values: FeeInvoiceFormValues) =>
      Services.feeInvoices.createFeeInvoice({
        studentId: values.student,
        academicSessionId: values.academic_session,
        issueDate: values.issue_date,
        dueDate: values.due_date,
        periodLabel: values.period_label,
      }),
    knownFields: FEE_INVOICE_CREATE_ERROR_FIELDS,
    onSuccess: (created) => {
      invalidateInvoices();
      toast.success(t("invoices.create.saved", { number: created.invoice_no }));
      onOpenChange(false);
    },
    fallbackMessage: tCommon("submitFailed"),
  });

  return (
    <FormDialogLayout
      open={open}
      onOpenChange={onOpenChange}
      title={t("invoices.create.title")}
      description={t("invoices.create.intro")}
      form={form}
      onSubmit={handleSubmit}
      formError={formError}
      isPending={isPending}
      submittingLabel={tCommon("saving")}
    >
      <FormField
        control={form.control}
        name="student"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t("invoices.create.student")}</FormLabel>
            <StudentPicker
              value={student}
              onChange={(picked) => {
                setStudent(picked);
                field.onChange(picked?.id ?? "");
              }}
            />
            <FormMessage />
          </FormItem>
        )}
      />
      <FormSelectField
        form={form}
        name="academic_session"
        label={t("invoices.create.session")}
        placeholder={t("invoices.create.selectSession")}
        options={references.sessions}
      />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField
          control={form.control}
          name="issue_date"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("invoices.create.issueDate")}</FormLabel>
              <FormControl>
                <Input type="date" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="due_date"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("invoices.create.dueDate")}</FormLabel>
              <FormControl>
                <Input type="date" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>
      <FormField
        control={form.control}
        name="period_label"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t("invoices.create.period")}</FormLabel>
            <FormControl>
              <Input maxLength={FEE_INVOICE_PERIOD_LABEL_MAX} {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
    </FormDialogLayout>
  );
}
