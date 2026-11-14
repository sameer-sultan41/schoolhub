"use client";

import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { ResponsiveAlertDialog } from "@/components/responsive-alert-dialog";
import { useConfirmAction } from "@/hooks/use-confirm-action";
import { useInvalidateModule } from "@/hooks/use-invalidate-module";
import { Services, type ExpenseCategoryRecord } from "@/services";
import { EXPENSE_CATEGORIES_QUERY_MODULE } from "@/services/modules/expense-categories/expense-categories-constant";

export interface DeleteCategoryDialogProps {
  record: ExpenseCategoryRecord;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Deletes one expense category. The server refuses one with expenses or a budget filed against
 * it (422): the reason shows inline and the dialog stays open.
 *
 * Mounting contract: the caller mounts this only while it is open, so every open starts with
 * no stale error.
 */
export function DeleteCategoryDialog({ record, open, onOpenChange }: DeleteCategoryDialogProps) {
  const t = useTranslations("fees");
  const tCommon = useTranslations("common");
  const invalidate = useInvalidateModule(EXPENSE_CATEGORIES_QUERY_MODULE);

  const { error, isPending, confirm } = useConfirmAction({
    mutationFn: () => Services.expenseCategories.deleteExpenseCategory(record.id),
    onSuccess: () => {
      invalidate();
      toast.success(t("expenses.categories.removed"));
      onOpenChange(false);
    },
    fallbackMessage: tCommon("submitFailed"),
  });

  return (
    <ResponsiveAlertDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("expenses.categories.delete.titleNamed", { name: record.name })}
      description={t("expenses.categories.delete.description")}
      confirmLabel={t("expenses.categories.actions.delete")}
      variant="destructive"
      isPending={isPending}
      error={error ?? undefined}
      onConfirm={confirm}
    />
  );
}
