"use client";

import { useLocale, useTranslations } from "next-intl";
import { useWatch, type UseFieldArrayReturn, type UseFormReturn } from "react-hook-form";
import {
  Button,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
} from "@schoolhub/ui";
import { Plus, Trash2 } from "lucide-react";

import { FormSelectField } from "@/components/form-select-field";
import { formatMoney } from "@/lib/format-decimal";
import { JOURNAL_MIN_LINES } from "@/services/modules/ledger-entries/ledger-entries-constant";
import {
  centsToDecimal,
  journalDifference,
} from "@/services/modules/ledger-entries/ledger-entries-helper";
import type { JournalFormValues } from "@/services/modules/ledger-entries/ledger-entries.schema";

export interface JournalLinesFieldsProps {
  form: UseFormReturn<JournalFormValues>;
  fields: UseFieldArrayReturn<JournalFormValues, "lines">["fields"];
  onAdd: () => void;
  onRemove: (index: number) => void;
  /** The accounts a line may post to (active ones: an archived account takes no posting). */
  accounts: readonly { id: string; name: string }[];
}

/**
 * The journal's debit and credit lines: an account, a debit and a credit each, and a running
 * difference beneath. The difference is a hint to the person typing, never the gate on Post: the
 * server decides whether the set balances and its refusal shows above the form. Every input
 * renders its own `FormMessage`, so a server error on a line shows under that line.
 */
export function JournalLinesFields({
  form,
  fields,
  onAdd,
  onRemove,
  accounts,
}: JournalLinesFieldsProps) {
  const t = useTranslations("fees");
  const locale = useLocale();
  const lines = useWatch({ control: form.control, name: "lines" });
  const totals = journalDifference(lines);

  return (
    <div className="space-y-3">
      {fields.map((field, index) => (
        <fieldset key={field.id} className="space-y-3 rounded-md border border-border p-3">
          <legend className="px-1 text-sm font-medium text-foreground">
            {t("ledger.journal.form.line", { number: index + 1 })}
          </legend>
          <FormSelectField
            form={form}
            name={`lines.${index}.ledger_account`}
            label={t("ledger.journal.form.account")}
            placeholder={t("ledger.journal.form.accountPlaceholder")}
            options={accounts}
          />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FormField
              control={form.control}
              name={`lines.${index}.debit`}
              render={({ field: input }) => (
                <FormItem>
                  <FormLabel>{t("ledger.journal.form.debit")}</FormLabel>
                  <FormControl>
                    <Input inputMode="decimal" {...input} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name={`lines.${index}.credit`}
              render={({ field: input }) => (
                <FormItem>
                  <FormLabel>{t("ledger.journal.form.credit")}</FormLabel>
                  <FormControl>
                    <Input inputMode="decimal" {...input} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
          {fields.length > JOURNAL_MIN_LINES && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                onRemove(index);
              }}
            >
              <Trash2 aria-hidden="true" />
              {t("ledger.journal.form.removeLine", { number: index + 1 })}
            </Button>
          )}
        </fieldset>
      ))}
      <Button type="button" variant="outline" size="sm" onClick={onAdd}>
        <Plus aria-hidden="true" />
        {t("ledger.journal.form.addLine")}
      </Button>
      <p
        role="status"
        className={`text-sm tabular-nums ${totals.balanced ? "text-muted-foreground" : "text-warning"}`}
      >
        {t("ledger.journal.form.totals", {
          debit: formatMoney(locale, centsToDecimal(totals.debit)),
          credit: formatMoney(locale, centsToDecimal(totals.credit)),
          difference: formatMoney(locale, centsToDecimal(totals.difference)),
        })}
      </p>
      <p className="text-xs text-muted-foreground">{t("ledger.journal.form.totalsHint")}</p>
    </div>
  );
}
