/** The payments module's constants. */

/** The query-key module every payment read lives under; a write invalidates it. */
export const PAYMENTS_QUERY_MODULE = "payments";
export const PAYMENTS_LIST_RESOURCE = "list";
/** One invoice's payments, which the invoice page shows read-only. */
export const PAYMENTS_BY_INVOICE_RESOURCE = "by-invoice";
/** Rows read for one invoice: an invoice has a handful of payments, so one page is its whole list. */
export const PAYMENTS_BY_INVOICE_PAGE_SIZE = 100;
