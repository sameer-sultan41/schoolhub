"use client";

import { useMemo } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { FormControl, FormField, FormItem, FormLabel, FormMessage, Input } from "@schoolhub/ui";

import { FormDialogLayout } from "@/components/form-dialog-layout";
import { FormSelectField } from "@/components/form-select-field";
import { useFormDialogSubmit } from "@/hooks/use-form-dialog-submit";
import { useInvalidateModule } from "@/hooks/use-invalidate-module";
import { activeOrCurrent } from "@/features/fees/shared/option-helpers";
import { Services, type ExpenseCategoryRecord } from "@/services";
import {
  EXPENSE_CATEGORIES_QUERY_MODULE,
  EXPENSE_CATEGORY_CODE_MAX,
  EXPENSE_CATEGORY_ERROR_FIELDS,
  EXPENSE_CATEGORY_NAME_MAX,
} from "@/services/modules/expense-categories/expense-categories-constant";
import {
  buildExpenseCategoryInput,
  defaultExpenseCategoryFormValues,
  recordToExpenseCategoryFormValues,
} from "@/services/modules/expense-categories/expense-categories-helper";
import {
  createExpenseCategoryFormSchema,
  type ExpenseCategoryFormValues,
} from "@/services/modules/expense-categories/expense-categories.schema";
import { FormSwitchField } from "@/features/fees/shared/form-switch-field";
import { useLedgerAccountOptions } from "@/features/fees/shared/use-fee-options";

export interface CategoryFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The category to edit; omitted to add one. */
  record?: ExpenseCategoryRecord;
}

/**
 * Adds an expense category, or edits one. The ledger account is picked from the expense accounts
 * (`account_type=expense`); the caller offers this form only to a viewer who may read ledger
 * accounts (L59), as that picker is required. A server error that names a field shows under it
 * (a non-expense account is refused under `ledger_account`); any other is the form's message.
 *
 * Mounting contract: the caller mounts this only while it is open, so every open is a fresh form.
 */
export function CategoryFormDialog({ open, onOpenChange, record }: CategoryFormDialogProps) {
  const t = useTranslations("fees");
  const tCommon = useTranslations("common");
  const invalidate = useInvalidateModule(EXPENSE_CATEGORIES_QUERY_MODULE);
  const accounts = useLedgerAccountOptions({ accountType: "expense" });

  const schema = useMemo(
    () => createExpenseCategoryFormSchema({ required: tCommon("requiredField") }),
    [tCommon],
  );
  const form = useForm<ExpenseCategoryFormValues>({
    resolver: zodResolver(schema),
    defaultValues: record
      ? recordToExpenseCategoryFormValues(record)
      : defaultExpenseCategoryFormValues(),
  });

  const { handleSubmit, formError, isPending } = useFormDialogSubmit({
    form,
    mutationFn: (values: ExpenseCategoryFormValues) =>
      record
        ? Services.expenseCategories.updateExpenseCategory(
            record.id,
            buildExpenseCategoryInput(values),
          )
        : Services.expenseCategories.createExpenseCategory(buildExpenseCategoryInput(values)),
    knownFields: EXPENSE_CATEGORY_ERROR_FIELDS,
    onSuccess: () => {
      invalidate();
      toast.success(t("expenses.categories.saved"));
      onOpenChange(false);
    },
    fallbackMessage: tCommon("submitFailed"),
  });

  return (
    <FormDialogLayout
      open={open}
      onOpenChange={onOpenChange}
      title={
        record ? t("expenses.categories.form.editTitle") : t("expenses.categories.form.createTitle")
      }
      description={t("expenses.categories.form.intro")}
      form={form}
      onSubmit={handleSubmit}
      formError={formError}
      isPending={isPending}
      submittingLabel={tCommon("saving")}
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <FormField
          control={form.control}
          name="code"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("expenses.categories.form.code")}</FormLabel>
              <FormControl>
                <Input maxLength={EXPENSE_CATEGORY_CODE_MAX} {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="sm:col-span-2">
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("expenses.categories.form.name")}</FormLabel>
                <FormControl>
                  <Input maxLength={EXPENSE_CATEGORY_NAME_MAX} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
      </div>
      {!accounts.isLoading && (
        <FormSelectField
          form={form}
          name="ledger_account"
          label={t("expenses.categories.form.account")}
          placeholder={t("expenses.categories.form.account")}
          options={activeOrCurrent(accounts.data ?? [], form.getValues("ledger_account")).map(
            (a) => ({
              id: a.id,
              name: `${a.code} ${a.name}`,
            }),
          )}
        />
      )}
      <FormSwitchField
        form={form}
        name="is_active"
        label={t("expenses.categories.form.active")}
        description={t("expenses.categories.form.activeHint")}
      />
    </FormDialogLayout>
  );
}
