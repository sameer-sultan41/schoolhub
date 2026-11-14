"use client";

import { useMemo } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  Textarea,
} from "@schoolhub/ui";

import { FormDialogLayout } from "@/components/form-dialog-layout";
import { FormSelectField } from "@/components/form-select-field";
import { useCurrentUser } from "@/hooks/use-current-user";
import { useFormDialogSubmit } from "@/hooks/use-form-dialog-submit";
import { useInvalidateModule } from "@/hooks/use-invalidate-module";
import { useCampuses } from "@/hooks/use-reference-data";
import { hasPermission } from "@/lib/permissions";
import { activeOrCurrent } from "@/features/fees/shared/option-helpers";
import { Services, type BudgetRecord } from "@/services";
import { BUDGET_NAME_MAX, BUDGETS_QUERY_MODULE } from "@/services/modules/budgets/budgets-constant";
import {
  budgetErrorFields,
  buildBudgetInput,
  defaultBudgetFormValues,
  mapBudgetTargetErrors,
  recordToBudgetFormValues,
} from "@/services/modules/budgets/budgets-helper";
import {
  createBudgetFormSchema,
  type BudgetFormValues,
} from "@/services/modules/budgets/budgets.schema";
import { NO_OPTION } from "@/services/modules/expenses/expenses-constant";
import {
  useExpenseCategoryOptions,
  useLedgerAccountOptions,
} from "@/features/fees/shared/use-fee-options";

export interface BudgetFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The draft budget to edit; omitted to add one. */
  record?: BudgetRecord;
}

/**
 * Adds a draft budget, or edits one. A budget names exactly one target: an expense category, or
 * (for a viewer who may read the ledger, L59) a ledger account. The server's refusals show under
 * their field, or as the form's message when they name none (both targets, neither).
 *
 * Mounting contract: the caller mounts this only while it is open, so every open is a fresh form.
 */
export function BudgetFormDialog({ open, onOpenChange, record }: BudgetFormDialogProps) {
  const t = useTranslations("fees");
  const tCommon = useTranslations("common");
  const invalidate = useInvalidateModule(BUDGETS_QUERY_MODULE);
  const { data: user } = useCurrentUser();
  const canReadLedger = hasPermission(user, "fees.ledger.view");
  const canReadCampuses = hasPermission(user, "school.campus.view");
  const categories = useExpenseCategoryOptions();
  const accounts = useLedgerAccountOptions({ accountType: "expense", enabled: canReadLedger });
  const campuses = useCampuses({ enabled: canReadCampuses });

  const schema = useMemo(
    () =>
      createBudgetFormSchema({
        required: tCommon("requiredField"),
        invalidAmount: t("expenses.expenses.form.invalidAmount"),
        periodOrder: t("expenses.budgets.form.periodOrder"),
      }),
    [tCommon, t],
  );
  const form = useForm<BudgetFormValues>({
    resolver: zodResolver(schema),
    defaultValues: record ? recordToBudgetFormValues(record) : defaultBudgetFormValues(),
  });
  const target = useWatch({ control: form.control, name: "target" });
  const currentTargetId = useWatch({ control: form.control, name: "target_id" });

  const { handleSubmit, formError, isPending } = useFormDialogSubmit({
    form,
    mutationFn: async (values: BudgetFormValues) => {
      try {
        return record
          ? await Services.budgets.updateBudget(record.id, buildBudgetInput(values))
          : await Services.budgets.createBudget(buildBudgetInput(values));
      } catch (error) {
        // The target's errors name the API field; the form's one input is `target_id`.
        throw mapBudgetTargetErrors(error);
      }
    },
    knownFields: () => budgetErrorFields(canReadCampuses),
    onSuccess: () => {
      invalidate();
      toast.success(t("expenses.budgets.saved"));
      onOpenChange(false);
    },
    fallbackMessage: tCommon("submitFailed"),
  });

  const targetOptions = (
    target === "category"
      ? activeOrCurrent(categories.data ?? [], currentTargetId)
      : activeOrCurrent(accounts.data ?? [], currentTargetId)
  ).map((r) => ({ id: r.id, name: `${r.code} ${r.name}` })) satisfies {
    id: string;
    name: string;
  }[];
  const targetListLoading = target === "category" ? categories.isLoading : accounts.isLoading;

  return (
    <FormDialogLayout
      open={open}
      onOpenChange={onOpenChange}
      title={record ? t("expenses.budgets.form.editTitle") : t("expenses.budgets.form.createTitle")}
      description={t("expenses.budgets.form.intro")}
      form={form}
      onSubmit={handleSubmit}
      formError={formError}
      isPending={isPending}
      submittingLabel={tCommon("saving")}
    >
      <FormField
        control={form.control}
        name="name"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t("expenses.budgets.form.name")}</FormLabel>
            <FormControl>
              <Input maxLength={BUDGET_NAME_MAX} {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      {canReadLedger && (
        <FormSelectField
          form={form}
          name="target"
          label={t("expenses.budgets.form.targetKind")}
          placeholder={t("expenses.budgets.form.targetKind")}
          onPick={() => {
            form.setValue("target_id", "");
          }}
          options={[
            { id: "category", name: t("expenses.budgets.form.kindCategory") },
            { id: "account", name: t("expenses.budgets.form.kindAccount") },
          ]}
        />
      )}
      {!targetListLoading && (
        <FormSelectField
          form={form}
          name="target_id"
          label={t(
            target === "category"
              ? "expenses.budgets.form.category"
              : "expenses.budgets.form.account",
          )}
          placeholder={t(
            target === "category"
              ? "expenses.budgets.form.category"
              : "expenses.budgets.form.account",
          )}
          options={targetOptions}
        />
      )}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField
          control={form.control}
          name="period_start"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("expenses.budgets.form.periodStart")}</FormLabel>
              <FormControl>
                <Input type="date" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="period_end"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("expenses.budgets.form.periodEnd")}</FormLabel>
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
        name="amount"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t("expenses.budgets.form.amount")}</FormLabel>
            <FormControl>
              <Input inputMode="decimal" {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      {canReadCampuses && !campuses.isLoading && (
        <FormSelectField
          form={form}
          name="campus"
          label={t("expenses.budgets.form.campus")}
          placeholder={t("expenses.budgets.form.allCampuses")}
          options={(campuses.data ?? []).map((c) => ({ id: c.id, name: c.name }))}
          emptyOption={{ value: NO_OPTION, label: t("expenses.budgets.form.allCampuses") }}
        />
      )}
      <FormField
        control={form.control}
        name="notes"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t("expenses.budgets.form.notes")}</FormLabel>
            <FormControl>
              <Textarea rows={2} {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
    </FormDialogLayout>
  );
}
