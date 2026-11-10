"use client";

import { useTranslations } from "next-intl";
import type { UseFormReturn } from "react-hook-form";
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  Textarea,
} from "@schoolhub/ui";

import { FormSelectField } from "@/components/form-select-field";
import { useCurrentUser } from "@/hooks/use-current-user";
import { useCampuses } from "@/hooks/use-reference-data";
import { enumLabel } from "@/lib/enum-label";
import { hasPermission } from "@/lib/permissions";
import {
  EXPENSE_PAYMENT_METHODS,
  EXPENSE_VENDOR_MAX,
  NO_OPTION,
} from "@/services/modules/expenses/expenses-constant";
import type { ExpenseFormValues } from "@/services/modules/expenses/expenses.schema";
import { EXPENSE_METHOD_LABEL_KEY } from "@/features/fees/shared/expense-labels";
import { useExpenseCategoryOptions } from "@/features/fees/shared/use-fee-options";

/**
 * The expense form's inputs. Every field renders its own `FormMessage`, so a server error the
 * dialog maps onto it shows under it. The category picker reads `fees.expense.view`, the key
 * the page is gated on; the campus is optional, so it hides itself for a viewer who cannot read
 * campuses (L55). Each select mounts once its list has loaded, so an edit's saved value is never
 * blanked by an option that has not registered yet.
 */
export function ExpenseFormFields({ form }: { form: UseFormReturn<ExpenseFormValues> }) {
  const t = useTranslations("fees");
  const { data: user } = useCurrentUser();
  const canReadCampuses = hasPermission(user, "school.campus.view");
  const categories = useExpenseCategoryOptions();
  const campuses = useCampuses({ enabled: canReadCampuses });

  return (
    <>
      {!categories.isLoading && (
        <FormSelectField
          form={form}
          name="expense_category"
          label={t("expenses.expenses.form.category")}
          placeholder={t("expenses.expenses.form.category")}
          options={(categories.data ?? [])
            .filter((c) => c.is_active !== false || c.id === form.getValues("expense_category"))
            .map((c) => ({ id: c.id, name: `${c.code} ${c.name}` }))}
        />
      )}
      <FormField
        control={form.control}
        name="description"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t("expenses.expenses.form.description")}</FormLabel>
            <FormControl>
              <Textarea rows={2} {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField
          control={form.control}
          name="vendor_name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("expenses.expenses.form.vendor")}</FormLabel>
              <FormControl>
                <Input maxLength={EXPENSE_VENDOR_MAX} {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="expense_date"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("expenses.expenses.form.date")}</FormLabel>
              <FormControl>
                <Input type="date" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="amount"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("expenses.expenses.form.amount")}</FormLabel>
              <FormControl>
                <Input inputMode="decimal" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="tax_amount"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("expenses.expenses.form.tax")}</FormLabel>
              <FormControl>
                <Input inputMode="decimal" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>
      <FormSelectField
        form={form}
        name="payment_method"
        label={t("expenses.expenses.form.method")}
        placeholder={t("expenses.expenses.form.noMethod")}
        options={EXPENSE_PAYMENT_METHODS.map((method) => ({
          id: method,
          name: enumLabel(t, EXPENSE_METHOD_LABEL_KEY, method),
        }))}
        emptyOption={{ value: NO_OPTION, label: t("expenses.expenses.form.noMethod") }}
      />
      {canReadCampuses && !campuses.isLoading && (
        <FormSelectField
          form={form}
          name="campus"
          label={t("expenses.expenses.form.campus")}
          placeholder={t("expenses.expenses.form.noCampus")}
          options={(campuses.data ?? []).map((c) => ({ id: c.id, name: c.name }))}
          emptyOption={{ value: NO_OPTION, label: t("expenses.expenses.form.noCampus") }}
        />
      )}
    </>
  );
}
