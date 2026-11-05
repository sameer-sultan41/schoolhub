import { listReceipts, fetchReceipt, downloadReceipt } from "./receipts-service";

export const ReceiptsService = {
  listReceipts,
  fetchReceipt,
  downloadReceipt,
};
export type { ReceiptFormat, ReceiptRecord, ReceiptsQuery } from "./receipts-type";
