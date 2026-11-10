"use client";

import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { ResponsiveAlertDialog } from "@/components/responsive-alert-dialog";
import { useConfirmAction } from "@/hooks/use-confirm-action";
import { useInvalidateModule } from "@/hooks/use-invalidate-module";
import { Services, type ExpenseRecord } from "@/services";
import { EXPENSES_QUERY_MODULE } from "@/services/modules/expenses/expenses-constant";
import { useInvalidatePostedSpend } from "./use-invalidate-posted-spend";

export type ExpenseConfirmAction = "submit" | "approve" | "reject" | "markPaid";

export interface ExpenseActionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  expense: ExpenseRecord;
  action: ExpenseConfirmAction;
}

const CALL: Record<ExpenseConfirmAction, (id: string) => Promise<unknown>> = {
  submit: (id) => Services.expenses.submitExpense(id),
  approve: (id) => Services.expenses.approveExpense(id),
  reject: (id) => Services.expenses.rejectExpense(id),
  markPaid: (id) => Services.expenses.markExpensePaid(id),
};

/**
 * Confirms one expense transition (Submit, Approve, Reject, Mark paid). The server's refusal
 * (the submitter approving their own expense, an expense that already moved on) shows inline
 * and the dialog stays open; the tab's list reloads on success.
 *
 * Mounting contract: the caller mounts this only while it is open, so every open starts with
 * no stale error.
 */
export function ExpenseActionDialog({
  open,
  onOpenChange,
  expense,
  action,
}: ExpenseActionDialogProps) {
  const t = useTranslations("fees");
  const tCommon = useTranslations("common");
  const invalidate = useInvalidateModule(EXPENSES_QUERY_MODULE);
  const invalidatePostedSpend = useInvalidatePostedSpend();
  const values = { number: expense.expense_no };

  const { error, isPending, confirm } = useConfirmAction({
    mutationFn: () => CALL[action](expense.id),
    onSuccess: () => {
      invalidate();
      // Approval is what posts to the ledger.
      if (action === "approve") invalidatePostedSpend();
      toast.success(t(`expenses.expenses.${action}.done`, values));
      onOpenChange(false);
    },
    fallbackMessage: tCommon("submitFailed"),
  });

  return (
    <ResponsiveAlertDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t(`expenses.expenses.${action}.title`, values)}
      description={t(`expenses.expenses.${action}.description`, values)}
      confirmLabel={t(`expenses.expenses.actions.${action}`)}
      variant={action === "reject" ? "destructive" : undefined}
      isPending={isPending}
      error={error ?? undefined}
      onConfirm={confirm}
    />
  );
}
