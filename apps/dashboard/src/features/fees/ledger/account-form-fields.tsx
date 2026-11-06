"use client";

import { useTranslations } from "next-intl";
import type { UseFormReturn } from "react-hook-form";
import { FormControl, FormField, FormItem, FormLabel, FormMessage, Input } from "@schoolhub/ui";

import { FormSelectField } from "@/components/form-select-field";
import { enumLabel } from "@/lib/enum-label";
import type { LedgerAccountRecord } from "@/services";
import {
  LEDGER_ACCOUNT_TYPES,
  LEDGER_CODE_MAX,
  LEDGER_NAME_MAX,
  NO_PARENT_OPTION,
} from "@/services/modules/ledger-accounts/ledger-accounts-constant";
import type { LedgerAccountFormValues } from "@/services/modules/ledger-accounts/ledger-accounts.schema";
import { LEDGER_ACCOUNT_TYPE_LABEL_KEY } from "../shared/fee-setup-labels";
import { FormSwitchField } from "../shared/form-switch-field";
import { useLedgerAccountOptions } from "../shared/use-fee-options";

export interface AccountFormFieldsProps {
  form: UseFormReturn<LedgerAccountFormValues>;
  /** The account being edited: it cannot be its own parent. */
  editingId?: string;
}

/**
 * The account form's inputs. Every field renders its own `FormMessage`, so a server error the
 * dialog maps onto it shows under it. The parent select mounts once the accounts have loaded,
 * so an edit's saved parent is never blanked by an option that has not registered yet.
 */
export function AccountFormFields({ form, editingId }: AccountFormFieldsProps) {
  const t = useTranslations("fees");
  const accountsQuery = useLedgerAccountOptions();
  const parents: readonly LedgerAccountRecord[] = (accountsQuery.data ?? []).filter(
    (account) => account.id !== editingId,
  );

  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <FormField
          control={form.control}
          name="code"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("ledger.accounts.form.code")}</FormLabel>
              <FormControl>
                <Input maxLength={LEDGER_CODE_MAX} {...field} />
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
                <FormLabel>{t("ledger.accounts.form.name")}</FormLabel>
                <FormControl>
                  <Input maxLength={LEDGER_NAME_MAX} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
      </div>
      <FormSelectField
        form={form}
        name="account_type"
        label={t("ledger.accounts.form.type")}
        placeholder={t("ledger.accounts.form.type")}
        options={LEDGER_ACCOUNT_TYPES.map((type) => ({
          id: type,
          name: enumLabel(t, LEDGER_ACCOUNT_TYPE_LABEL_KEY, type),
        }))}
      />
      {!accountsQuery.isLoading && (
        <FormSelectField
          form={form}
          name="parent"
          label={t("ledger.accounts.form.parent")}
          placeholder={t("ledger.accounts.form.noParent")}
          options={parents.map((account) => ({
            id: account.id,
            name: `${account.code} ${account.name}`,
          }))}
          emptyOption={{ value: NO_PARENT_OPTION, label: t("ledger.accounts.form.noParent") }}
        />
      )}
      <FormSwitchField
        form={form}
        name="is_active"
        label={t("ledger.accounts.form.active")}
        description={t("ledger.accounts.form.activeHint")}
      />
    </>
  );
}
