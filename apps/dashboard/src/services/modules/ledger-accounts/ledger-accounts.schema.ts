import { z } from "zod";

import { LEDGER_ACCOUNT_TYPES, LEDGER_CODE_MAX, LEDGER_NAME_MAX } from "./ledger-accounts-constant";
import type { LedgerAccountType } from "./ledger-accounts-type";

/** The account form's schema, with the API's own field names (`parent`, `is_active`). */

const accountTypeEnum = z.enum(LEDGER_ACCOUNT_TYPES as [LedgerAccountType, ...LedgerAccountType[]]);

export type LedgerAccountFormMessages = Record<"required", string>;
export const LEDGER_ACCOUNT_FORM_MESSAGE_KEYS: LedgerAccountFormMessages = { required: "required" };

/** `parent` is `""` for a top-level account. */
export function createLedgerAccountFormSchema(messages: LedgerAccountFormMessages) {
  return z.object({
    code: z.string().trim().min(1, messages.required).max(LEDGER_CODE_MAX),
    name: z.string().trim().min(1, messages.required).max(LEDGER_NAME_MAX),
    account_type: accountTypeEnum,
    parent: z.string(),
    is_active: z.boolean(),
  });
}

export const ledgerAccountFormSchema = createLedgerAccountFormSchema(
  LEDGER_ACCOUNT_FORM_MESSAGE_KEYS,
);
export type LedgerAccountFormValues = z.infer<typeof ledgerAccountFormSchema>;
