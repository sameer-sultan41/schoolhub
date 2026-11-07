import {
  cancelFeeInvoice,
  createFeeInvoice,
  fetchFeeInvoice,
  generateFeeInvoices,
  listFeeInvoices,
} from "./fee-invoices-service";

export const FeeInvoicesService = {
  listFeeInvoices,
  fetchFeeInvoice,
  createFeeInvoice,
  generateFeeInvoices,
  cancelFeeInvoice,
};
export type {
  FeeInvoiceInput,
  FeeInvoiceLineRecord,
  FeeInvoiceRecord,
  FeeInvoicesQuery,
  FeeInvoiceStatus,
  GenerateInvoicesAccepted,
  GenerateInvoicesInput,
  GenerateInvoicesResult,
} from "./fee-invoices-type";
