import {
  cancelFeeInvoice,
  fetchFeeInvoice,
  generateFeeInvoices,
  listFeeInvoices,
} from "./fee-invoices-service";

export const FeeInvoicesService = {
  listFeeInvoices,
  fetchFeeInvoice,
  generateFeeInvoices,
  cancelFeeInvoice,
};
export type {
  FeeInvoiceLineRecord,
  FeeInvoiceRecord,
  FeeInvoicesQuery,
  FeeInvoiceStatus,
  GenerateInvoicesAccepted,
  GenerateInvoicesInput,
  GenerateInvoicesResult,
} from "./fee-invoices-type";
