import { listReceipts, downloadReceipt } from "./receipts-service";

export const ReceiptsService = {
  listReceipts,
  downloadReceipt,
};
export type { ReceiptFormat, ReceiptRecord, ReceiptsQuery } from "./receipts-type";
