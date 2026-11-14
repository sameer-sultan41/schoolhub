import type { FeeInvoiceLineRecord } from "@/services";

/** Each invoice line's source to its message key in the `fees` namespace. Exhaustive (L32). */
export const INVOICE_LINE_SOURCE_LABEL_KEY: Record<FeeInvoiceLineRecord["source_type"], string> = {
  schedule: "invoices.detail.source.schedule",
  fine: "invoices.detail.source.fine",
  adjustment: "invoices.detail.source.adjustment",
};
