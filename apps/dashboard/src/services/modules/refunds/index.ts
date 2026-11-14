import {
  approveRefund,
  createRefund,
  listRefunds,
  processRefund,
  rejectRefund,
} from "./refunds-service";

export const RefundsService = {
  listRefunds,
  createRefund,
  approveRefund,
  rejectRefund,
  processRefund,
};
export type {
  ProcessRefundInput,
  RefundDecisionInput,
  RefundRecord,
  RefundsQuery,
  RefundStatus,
  RequestRefundInput,
} from "./refunds-type";
