/** The Payments page's sub-tab ids, as `?tab=` carries them. Payments is first, so it is the default and leaves the key out. */
export const PAYMENTS_TAB_ID = "payments";
export const RECEIPTS_TAB_ID = "receipts";
export const VOUCHERS_TAB_ID = "vouchers";
export const REFUNDS_TAB_ID = "refunds";
export const SETTLEMENT_IMPORTS_TAB_ID = "imports";

/** The URL keys the tabs' lists own (their filters), cleared on a tab change. */
export const PAYMENTS_URL_FILTER_KEYS = [
  "method",
  "status",
  "from",
  "to",
  "cashier",
  "provider",
] as const;
