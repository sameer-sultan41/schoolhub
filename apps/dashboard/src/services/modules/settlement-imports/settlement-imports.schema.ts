import { z } from "zod";

import {
  DEFAULT_VOUCHER_PROVIDER,
  VOUCHER_PROVIDERS,
} from "@/services/modules/vouchers/vouchers-constant";
import type { VoucherProvider } from "@/services/modules/vouchers/vouchers-type";

/** The upload form's schema, with the API's own field names. */

export function createSettlementUploadFormSchema(messages: { required: string }) {
  return z.object({
    provider: z.custom<VoucherProvider>(
      (value) => VOUCHER_PROVIDERS.includes(value as VoucherProvider),
      messages.required,
    ),
    // The picked file; an empty slot is `null` until the person chooses one.
    file: z.custom<File | null>((value) => value instanceof File, messages.required),
  });
}
export const settlementUploadFormSchema = createSettlementUploadFormSchema({
  required: "required",
});
export type SettlementUploadFormValues = z.infer<typeof settlementUploadFormSchema>;

export function defaultSettlementUploadFormValues(): SettlementUploadFormValues {
  return { provider: DEFAULT_VOUCHER_PROVIDER, file: null };
}
