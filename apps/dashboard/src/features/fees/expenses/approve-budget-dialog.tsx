"use client";

import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { ResponsiveAlertDialog } from "@/components/responsive-alert-dialog";
import { useConfirmAction } from "@/hooks/use-confirm-action";
import { useInvalidateModule } from "@/hooks/use-invalidate-module";
import { Services, type BudgetRecord } from "@/services";
import { BUDGETS_QUERY_MODULE } from "@/services/modules/budgets/budgets-constant";

export interface ApproveBudgetDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  budget: BudgetRecord;
}

/**
 * Approves a draft budget, which then becomes the variance report's baseline. The server's
 * refusal shows inline and the dialog stays open.
 *
 * Mounting contract: the caller mounts this only while it is open.
 */
export function ApproveBudgetDialog({ open, onOpenChange, budget }: ApproveBudgetDialogProps) {
  const t = useTranslations("fees");
  const tCommon = useTranslations("common");
  const invalidate = useInvalidateModule(BUDGETS_QUERY_MODULE);
  const values = { name: budget.name };

  const { error, isPending, confirm } = useConfirmAction({
    mutationFn: () => Services.budgets.approveBudget(budget.id),
    onSuccess: () => {
      invalidate();
      toast.success(t("expenses.budgets.approve.done", values));
      onOpenChange(false);
    },
    fallbackMessage: tCommon("submitFailed"),
  });

  return (
    <ResponsiveAlertDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("expenses.budgets.approve.title", values)}
      description={t("expenses.budgets.approve.description")}
      confirmLabel={t("expenses.budgets.actions.approve")}
      isPending={isPending}
      error={error ?? undefined}
      onConfirm={confirm}
    />
  );
}
