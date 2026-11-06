import type { VoucherRecord } from "@/services";

/** Each payment provider's message key under `portal.fees.vouchers.providers` (exhaustive). */
export const VOUCHER_PROVIDER_LABEL_KEY: Record<VoucherRecord["provider"], string> = {
  bank_branch: "vouchers.providers.bank_branch",
  easypaisa: "vouchers.providers.easypaisa",
  jazzcash: "vouchers.providers.jazzcash",
};
