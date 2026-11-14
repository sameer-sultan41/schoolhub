"use client";

import { useTranslations } from "next-intl";

import { Services, type ExpenseRecord } from "@/services";
import {
  EXPENSE_REASON_ERROR_FIELDS,
  EXPENSE_REASON_MAX,
  EXPENSES_QUERY_MODULE,
} from "@/services/modules/expenses/expenses-constant";
import { ReasonDialog } from "@/features/fees/shared/reason-dialog";
import { useInvalidatePostedSpend } from "./use-invalidate-posted-spend";

export interface ReverseExpenseDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  expense: ExpenseRecord;
}

/**
 * Reverses an approved or paid expense: the ledger posting is undone by a new entry, and the
 * reason is required. The server's refusal shows inline.
 *
 * Mounting contract: the caller mounts this only while it is open.
 */
export function ReverseExpenseDialog({ open, onOpenChange, expense }: ReverseExpenseDialogProps) {
  const t = useTranslations("fees");
  const invalidatePostedSpend = useInvalidatePostedSpend();
  const values = { number: expense.expense_no };

  return (
    <ReasonDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("expenses.expenses.reverse.title", values)}
      intro={t("expenses.expenses.reverse.description", values)}
      reasonLabel={t("expenses.expenses.reverse.reason")}
      reasonMax={EXPENSE_REASON_MAX}
      submitLabel={t("expenses.expenses.actions.reverse")}
      doneMessage={t("expenses.expenses.reverse.done", values)}
      queryModule={EXPENSES_QUERY_MODULE}
      action={(reason) => Services.expenses.reverseExpense(expense.id, reason)}
      onDone={invalidatePostedSpend}
      knownFields={EXPENSE_REASON_ERROR_FIELDS}
    />
  );
}
