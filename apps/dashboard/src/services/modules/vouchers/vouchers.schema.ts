import { z } from "zod";

import {
  DEFAULT_VOUCHER_PROVIDER,
  VOUCHER_PROVIDERS,
  VOUCHER_VALIDITY_DAYS_MAX,
} from "./vouchers-constant";
import type { VoucherProvider } from "./vouchers-type";

/** The issue-voucher form's schema, with the API's own field names. */

export type IssueVoucherFormMessages = Record<"required" | "validity", string>;

const DAYS_PATTERN = /^\d+$/;

export function createIssueVoucherFormSchema(messages: IssueVoucherFormMessages) {
  return z.object({
    provider: z.custom<VoucherProvider>(
      (value) => VOUCHER_PROVIDERS.includes(value as VoucherProvider),
      messages.required,
    ),
    // Blank keeps the school's default validity; otherwise whole days from 1 to the server's cap.
    validity_days: z
      .string()
      .trim()
      .refine(
        (value) =>
          value === "" ||
          (DAYS_PATTERN.test(value) &&
            Number(value) >= 1 &&
            Number(value) <= VOUCHER_VALIDITY_DAYS_MAX),
        messages.validity,
      ),
  });
}
export const issueVoucherFormSchema = createIssueVoucherFormSchema({
  required: "required",
  validity: "validity",
});
export type IssueVoucherFormValues = z.infer<typeof issueVoucherFormSchema>;

export function defaultIssueVoucherFormValues(): IssueVoucherFormValues {
  return { provider: DEFAULT_VOUCHER_PROVIDER, validity_days: "" };
}
