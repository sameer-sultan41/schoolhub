import { z } from "zod";

import { JOURNAL_MEMO_MAX } from "./ledger-entries-constant";

/** The journal form's schema, with the API's own field names. */

export type JournalFormMessages = Record<"required" | "invalidAmount", string>;

const AMOUNT_PATTERN = /^\d+(\.\d{1,2})?$/;

/**
 * Amounts are kept as typed text and sent as is: the server owns the decimal and the balance.
 * A line leaves one of `debit` and `credit` blank; which one, and that the set balances, are the
 * server's to decide, so the schema checks only that each typed amount is a number.
 */
export function createJournalFormSchema(messages: JournalFormMessages) {
  const amount = z
    .string()
    .trim()
    .refine((value) => value === "" || AMOUNT_PATTERN.test(value), messages.invalidAmount);
  return z.object({
    entry_date: z.string().min(1, messages.required),
    memo: z.string().trim().min(1, messages.required).max(JOURNAL_MEMO_MAX),
    lines: z.array(
      z.object({
        ledger_account: z.string().min(1, messages.required),
        debit: amount,
        credit: amount,
      }),
    ),
  });
}
export const journalFormSchema = createJournalFormSchema({
  required: "required",
  invalidAmount: "invalidAmount",
});
export type JournalFormValues = z.infer<typeof journalFormSchema>;
