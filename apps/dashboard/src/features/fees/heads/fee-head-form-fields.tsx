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
  Skeleton,
} from "@schoolhub/ui";

import { FormSelectField } from "@/components/form-select-field";
import { useCurrentUser } from "@/hooks/use-current-user";
import { enumLabel } from "@/lib/enum-label";
import { hasPermission } from "@/lib/permissions";
import {
  FEE_HEAD_CATEGORIES,
  FEE_HEAD_CODE_MAX,
  FEE_HEAD_NAME_MAX,
} from "@/services/modules/fee-heads/fee-heads-constant";
import type { FeeHeadFormValues } from "@/services/modules/fee-heads/fee-heads.schema";
import { FEE_HEAD_CATEGORY_LABEL_KEY } from "../shared/fee-setup-labels";
import { FormSwitchField } from "../shared/form-switch-field";
import { useLedgerAccountOptions } from "../shared/use-fee-options";

/**
 * The fee head form's inputs. The account picker lists only income accounts (the server refuses
 * any other, `assert_fee_head_account_is_income`), and is read only for a holder of
 * `fees.ledger.view` (L55). It mounts once the accounts have loaded, so an edit's saved account
 * is never blanked by an option that has not registered yet. Every field renders its own
 * `FormMessage`, so a server error the dialog maps onto it shows under it.
 */
export function FeeHeadFormFields({ form }: { form: UseFormReturn<FeeHeadFormValues> }) {
  const t = useTranslations("fees");
  const { data: user } = useCurrentUser();
  const canReadLedger = hasPermission(user, "fees.ledger.view");
  const accountsQuery = useLedgerAccountOptions({
    accountType: "income",
    isActive: true,
    enabled: canReadLedger,
  });

  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <FormField
          control={form.control}
          name="code"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("heads.form.code")}</FormLabel>
              <FormControl>
                <Input maxLength={FEE_HEAD_CODE_MAX} {...field} />
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
                <FormLabel>{t("heads.form.name")}</FormLabel>
                <FormControl>
                  <Input maxLength={FEE_HEAD_NAME_MAX} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
      </div>
      <FormSelectField
        form={form}
        name="category"
        label={t("heads.form.category")}
        placeholder={t("heads.form.category")}
        options={FEE_HEAD_CATEGORIES.map((category) => ({
          id: category,
          name: enumLabel(t, FEE_HEAD_CATEGORY_LABEL_KEY, category),
        }))}
      />
      {accountsQuery.isLoading ? (
        <Skeleton className="h-16 w-full" />
      ) : (
        <FormSelectField
          form={form}
          name="ledger_account"
          label={t("heads.form.account")}
          placeholder={t("heads.form.selectAccount")}
          options={(accountsQuery.data ?? []).map((account) => ({
            id: account.id,
            name: `${account.code} ${account.name}`,
          }))}
          description={canReadLedger ? undefined : t("heads.form.noLedgerAccess")}
        />
      )}
      <FormSwitchField
        form={form}
        name="is_refundable"
        label={t("heads.form.refundable")}
        description={t("heads.form.refundableHint")}
      />
      <FormSwitchField
        form={form}
        name="is_active"
        label={t("heads.form.active")}
        description={t("heads.form.activeHint")}
      />
    </>
  );
}
