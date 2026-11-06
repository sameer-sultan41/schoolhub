import type { FeeInvoiceRecord } from "@/services";

type FeeInvoiceStatus = FeeInvoiceRecord["status"];

/** Every invoice status to its message key under `portal.fees` (L32: exhaustive). */
export const FEE_STATUS_LABEL_KEY: Record<FeeInvoiceStatus, `status.${FeeInvoiceStatus}`> = {
  draft: "status.draft",
  issued: "status.issued",
  partially_paid: "status.partially_paid",
  paid: "status.paid",
  overdue: "status.overdue",
  canceled: "status.canceled",
};

export const FEE_STATUS_BADGE: Record<
  FeeInvoiceStatus,
  "primary" | "success" | "warning" | "destructive" | "secondary"
> = {
  draft: "secondary",
  issued: "primary",
  partially_paid: "warning",
  paid: "success",
  overdue: "destructive",
  canceled: "secondary",
};
