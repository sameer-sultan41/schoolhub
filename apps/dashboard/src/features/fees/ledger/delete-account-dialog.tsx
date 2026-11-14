"use client";

import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { ResponsiveAlertDialog } from "@/components/responsive-alert-dialog";
import { useConfirmAction } from "@/hooks/use-confirm-action";
import { useInvalidateModule } from "@/hooks/use-invalidate-module";
import { Services, type LedgerAccountRecord } from "@/services";
import { LEDGER_ACCOUNTS_QUERY_MODULE } from "@/services/modules/ledger-accounts/ledger-accounts-constant";

export interface DeleteAccountDialogProps {
  record: LedgerAccountRecord;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Deletes one ledger account. The server refuses an account with postings (422): the reason
 * shows inline and the dialog stays open.
 *
 * Mounting contract: the caller mounts this only while it is open, so every open starts with
 * no stale error.
 */
export function DeleteAccountDialog({ record, open, onOpenChange }: DeleteAccountDialogProps) {
  const t = useTranslations("fees");
  const tCommon = useTranslations("common");
  const invalidateAccounts = useInvalidateModule(LEDGER_ACCOUNTS_QUERY_MODULE);

  const { error, isPending, confirm } = useConfirmAction({
    mutationFn: () => Services.ledgerAccounts.deleteLedgerAccount(record.id),
    onSuccess: () => {
      invalidateAccounts();
      toast.success(t("ledger.accounts.removed"));
      onOpenChange(false);
    },
    fallbackMessage: tCommon("submitFailed"),
  });

  return (
    <ResponsiveAlertDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("ledger.accounts.delete.titleNamed", { name: record.name })}
      description={t("ledger.accounts.delete.description")}
      confirmLabel={t("ledger.accounts.actions.delete")}
      variant="destructive"
      isPending={isPending}
      error={error ?? undefined}
      onConfirm={confirm}
    />
  );
}
