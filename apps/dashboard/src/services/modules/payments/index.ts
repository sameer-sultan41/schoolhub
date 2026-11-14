import { listPayments, recordPayment } from "./payments-service";

export const PaymentsService = {
  listPayments,
  recordPayment,
};
export type {
  CounterPaymentMethod,
  PaymentMethod,
  PaymentRecord,
  PaymentsQuery,
  PaymentStatus,
  RecordPaymentInput,
} from "./payments-type";
