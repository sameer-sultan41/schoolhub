"use client";

import { useMemo } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { useFieldArray, useForm } from "react-hook-form";
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
import { useFormDialogSubmit } from "@/hooks/use-form-dialog-submit";
import { useIdempotencyKey } from "@/hooks/use-idempotency-key";
import { useInvalidateModule } from "@/hooks/use-invalidate-module";
import { resolveErrorMessage } from "@/lib/error-message";
import { Services } from "@/services";
import {
  JOURNAL_ERROR_FIELDS,
  JOURNAL_LINE_FIELDS,
  JOURNAL_MEMO_MAX,
  LEDGER_ENTRIES_QUERY_MODULE,
} from "@/services/modules/ledger-entries/ledger-entries-constant";
import {
  buildJournalInput,
  defaultJournalFormValues,
  mapJournalLineErrors,
} from "@/services/modules/ledger-entries/ledger-entries-helper";
import {
  createJournalFormSchema,
  type JournalFormValues,
} from "@/services/modules/ledger-entries/ledger-entries.schema";
import { useLedgerAccountOptions } from "@/features/fees/shared/use-fee-options";
import { JournalLinesFields } from "./journal-lines-fields";

export interface PostJournalDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Posts a hand-written journal entry (`fees.ledger.create`). The `Idempotency-Key` stands for
 * one posting and lives in a ref for the dialog's lifetime, so a double submit or a retry after
 * a lost response replays the first posting instead of posting twice onto a ledger that only an
 * offsetting entry can correct. Any edit renews it (the server refuses one key with a different
 * body), and success drops it. The balance is the server's to judge: its refusal ("debits total
 * ... and credits total ...") shows above the form, a refusal naming a line shows under that
 * line, and nothing client-side holds Post back.
 *
 * Mounting contract: the caller mounts this only while it is open, so every open is a fresh form
 * and a fresh key.
 */
export function PostJournalDialog({ open, onOpenChange }: PostJournalDialogProps) {
  const t = useTranslations("fees");
  const tCommon = useTranslations("common");
  const invalidate = useInvalidateModule(LEDGER_ENTRIES_QUERY_MODULE);
  const tErrors = useTranslations("errors");
  const accounts = useLedgerAccountOptions({ isActive: true });
  // The lines cannot be filled without the accounts: say so, and hold Post back, instead of showing a form with no lines.
  const accountsError = accounts.isError
    ? resolveErrorMessage(accounts.error, tErrors, t("ledger.journal.form.accountsError"))
    : null;

  const schema = useMemo(
    () =>
      createJournalFormSchema({
        required: tCommon("requiredField"),
        invalidAmount: t("ledger.journal.form.invalidAmount"),
      }),
    [tCommon, t],
  );
  const form = useForm<JournalFormValues>({
    resolver: zodResolver(schema),
    defaultValues: defaultJournalFormValues(),
  });
  const { fields, append, remove } = useFieldArray({ control: form.control, name: "lines" });
  const idempotencyKey = useIdempotencyKey(form);

  const { handleSubmit, formError, isPending } = useFormDialogSubmit({
    form,
    mutationFn: async (values: JournalFormValues) => {
      try {
        return await Services.ledgerEntries.postJournal(
          buildJournalInput(values),
          idempotencyKey.current(),
        );
      } catch (error) {
        // A per-line error is re-keyed as the form's own path, to show under that line.
        throw mapJournalLineErrors(error);
      }
    },
    // The inputs that exist now: a line's three, for each line the form has at the time of the error.
    knownFields: () => [
      ...JOURNAL_ERROR_FIELDS,
      ...fields.flatMap((_, index) => JOURNAL_LINE_FIELDS.map((name) => `lines.${index}.${name}`)),
    ],
    onSuccess: () => {
      idempotencyKey.clear();
      invalidate();
      toast.success(t("ledger.journal.posted"));
      onOpenChange(false);
    },
    fallbackMessage: tCommon("submitFailed"),
  });

  return (
    <FormDialogLayout
      open={open}
      onOpenChange={onOpenChange}
      title={t("ledger.journal.form.title")}
      description={t("ledger.journal.form.intro")}
      form={form}
      onSubmit={handleSubmit}
      formError={formError ?? accountsError}
      submitDisabled={accounts.isError}
      isPending={isPending}
      submittingLabel={t("ledger.journal.form.posting")}
      submitLabel={t("ledger.journal.form.submit")}
    >
      <FormField
        control={form.control}
        name="entry_date"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t("ledger.journal.form.date")}</FormLabel>
            <FormControl>
              <Input type="date" {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={form.control}
        name="memo"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t("ledger.journal.form.memo")}</FormLabel>
            <FormControl>
              <Textarea rows={2} maxLength={JOURNAL_MEMO_MAX} {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      {!accounts.isLoading && (
        <JournalLinesFields
          form={form}
          fields={fields}
          accounts={(accounts.data ?? []).map((account) => ({
            id: account.id,
            name: `${account.code} ${account.name}`,
          }))}
          onAdd={() => {
            idempotencyKey.clear();
            append({ ledger_account: "", debit: "", credit: "" });
          }}
          onRemove={(index) => {
            idempotencyKey.clear();
            remove(index);
          }}
        />
      )}
    </FormDialogLayout>
  );
}
