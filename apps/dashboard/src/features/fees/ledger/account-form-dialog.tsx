"use client";

import { useMemo } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { FormDialogLayout } from "@/components/form-dialog-layout";
import { useFormDialogSubmit } from "@/hooks/use-form-dialog-submit";
import { useInvalidateModule } from "@/hooks/use-invalidate-module";
import { Services, type LedgerAccountRecord } from "@/services";
import {
  LEDGER_ACCOUNT_ERROR_FIELDS,
  LEDGER_ACCOUNTS_QUERY_MODULE,
} from "@/services/modules/ledger-accounts/ledger-accounts-constant";
import {
  buildLedgerAccountInput,
  defaultLedgerAccountFormValues,
  recordToLedgerAccountFormValues,
} from "@/services/modules/ledger-accounts/ledger-accounts-helper";
import {
  createLedgerAccountFormSchema,
  type LedgerAccountFormValues,
} from "@/services/modules/ledger-accounts/ledger-accounts.schema";
import { AccountFormFields } from "./account-form-fields";

export interface AccountFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The account to edit; omitted to add one. */
  record?: LedgerAccountRecord;
}

/**
 * Adds a ledger account, or edits one. A server error that names a field is shown under it; any
 * other is the form's own message.
 *
 * Mounting contract: the caller mounts this only while it is open, so every open is a fresh
 * form. An edit starts from the record the caller holds, so no prefill lands after mount.
 */
export function AccountFormDialog({ open, onOpenChange, record }: AccountFormDialogProps) {
  const t = useTranslations("fees");
  const tCommon = useTranslations("common");
  const invalidateAccounts = useInvalidateModule(LEDGER_ACCOUNTS_QUERY_MODULE);

  const schema = useMemo(
    () => createLedgerAccountFormSchema({ required: tCommon("requiredField") }),
    [tCommon],
  );
  const form = useForm<LedgerAccountFormValues>({
    resolver: zodResolver(schema),
    defaultValues: record
      ? recordToLedgerAccountFormValues(record)
      : defaultLedgerAccountFormValues(),
  });

  const { handleSubmit, formError, isPending } = useFormDialogSubmit({
    form,
    mutationFn: (values: LedgerAccountFormValues) =>
      record
        ? Services.ledgerAccounts.updateLedgerAccount(record.id, buildLedgerAccountInput(values))
        : Services.ledgerAccounts.createLedgerAccount(buildLedgerAccountInput(values)),
    knownFields: LEDGER_ACCOUNT_ERROR_FIELDS,
    onSuccess: () => {
      invalidateAccounts();
      toast.success(t("ledger.accounts.saved"));
      onOpenChange(false);
    },
    fallbackMessage: tCommon("submitFailed"),
  });

  return (
    <FormDialogLayout
      open={open}
      onOpenChange={onOpenChange}
      title={record ? t("ledger.accounts.form.editTitle") : t("ledger.accounts.form.createTitle")}
      description={t("ledger.accounts.form.intro")}
      form={form}
      onSubmit={handleSubmit}
      formError={formError}
      isPending={isPending}
      submittingLabel={tCommon("saving")}
    >
      <AccountFormFields form={form} editingId={record?.id} />
    </FormDialogLayout>
  );
}
