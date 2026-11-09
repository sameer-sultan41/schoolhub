import type { VoucherRecord } from "@/services";

/** Each payment provider's message key under `portal.fees.vouchers.providers` (exhaustive). */
export const VOUCHER_PROVIDER_LABEL_KEY: Record<VoucherRecord["provider"], string> = {
  bank_branch: "vouchers.providers.bank_branch",
  easypaisa: "vouchers.providers.easypaisa",
  jazzcash: "vouchers.providers.jazzcash",
};

/** Each voucher status's message key in the `fees` namespace (the staff invoice page). Exhaustive (L32). */
export const VOUCHER_STATUS_LABEL_KEY: Record<VoucherRecord["status"], string> = {
  issued: "invoices.vouchers.status.issued",
  paid: "invoices.vouchers.status.paid",
  void: "invoices.vouchers.status.void",
  expired: "invoices.vouchers.status.expired",
};

/** Each voucher status's badge variant (exhaustive, L32). */
export const VOUCHER_STATUS_BADGE: Record<
  VoucherRecord["status"],
  "primary" | "success" | "warning" | "destructive" | "secondary"
> = {
  issued: "primary",
  paid: "success",
  void: "secondary",
  expired: "warning",
};
