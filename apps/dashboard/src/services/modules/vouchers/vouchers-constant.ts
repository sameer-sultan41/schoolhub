/** The vouchers module's constants. */

/** The query-key module every voucher read lives under; a write invalidates it. */
export const VOUCHERS_QUERY_MODULE = "vouchers";
export const VOUCHERS_BY_INVOICE_RESOURCE = "by-invoice";
/** One invoice has a handful of vouchers: one page is its whole list. */
export const VOUCHERS_BY_INVOICE_PAGE_SIZE = 100;
