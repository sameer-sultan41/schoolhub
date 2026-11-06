import { listFeeInvoices, fetchFeeInvoice } from "./fee-invoices-service";

export const FeeInvoicesService = {
  listFeeInvoices,
  fetchFeeInvoice,
};
export type { FeeInvoiceRecord, FeeInvoicesQuery } from "./fee-invoices-type";
