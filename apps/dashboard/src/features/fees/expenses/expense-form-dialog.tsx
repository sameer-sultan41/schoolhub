"use client";

import { useMemo } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { FormDialogLayout } from "@/components/form-dialog-layout";
import { useFormDialogSubmit } from "@/hooks/use-form-dialog-submit";
import { useInvalidateModule } from "@/hooks/use-invalidate-module";
import { Services, type ExpenseRecord } from "@/services";
import {
  EXPENSE_ERROR_FIELDS,
  EXPENSES_QUERY_MODULE,
} from "@/services/modules/expenses/expenses-constant";
import {
  buildExpenseInput,
  defaultExpenseFormValues,
  recordToExpenseFormValues,
} from "@/services/modules/expenses/expenses-helper";
import {
  createExpenseFormSchema,
  type ExpenseFormValues,
} from "@/services/modules/expenses/expenses.schema";
import { ExpenseFormFields } from "./expense-form-fields";

export interface ExpenseFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The draft to edit; omitted to record a new expense (saved as a draft). */
  record?: ExpenseRecord;
}

/**
 * Records a draft expense, or edits one. A server error that names a field is shown under it;
 * any other (an expense that is no longer a draft, refused under `status`) is the form's own
 * message.
 *
 * Mounting contract: the caller mounts this only while it is open, so every open is a fresh
 * form that starts from the record the caller holds.
 */
export function ExpenseFormDialog({ open, onOpenChange, record }: ExpenseFormDialogProps) {
  const t = useTranslations("fees");
  const tCommon = useTranslations("common");
  const invalidate = useInvalidateModule(EXPENSES_QUERY_MODULE);

  const schema = useMemo(
    () =>
      createExpenseFormSchema({
        required: tCommon("requiredField"),
        invalidAmount: t("expenses.expenses.form.invalidAmount"),
      }),
    [tCommon, t],
  );
  const form = useForm<ExpenseFormValues>({
    resolver: zodResolver(schema),
    defaultValues: record ? recordToExpenseFormValues(record) : defaultExpenseFormValues(),
  });

  const { handleSubmit, formError, isPending } = useFormDialogSubmit({
    form,
    mutationFn: (values: ExpenseFormValues) =>
      record
        ? Services.expenses.updateExpense(record.id, buildExpenseInput(values))
        : Services.expenses.createExpense(buildExpenseInput(values)),
    knownFields: EXPENSE_ERROR_FIELDS,
    onSuccess: () => {
      invalidate();
      toast.success(t("expenses.expenses.saved"));
      onOpenChange(false);
    },
    fallbackMessage: tCommon("submitFailed"),
  });

  return (
    <FormDialogLayout
      open={open}
      onOpenChange={onOpenChange}
      title={
        record ? t("expenses.expenses.form.editTitle") : t("expenses.expenses.form.createTitle")
      }
      description={t("expenses.expenses.form.intro")}
      form={form}
      onSubmit={handleSubmit}
      formError={formError}
      isPending={isPending}
      submittingLabel={tCommon("saving")}
    >
      <ExpenseFormFields form={form} />
    </FormDialogLayout>
  );
}
