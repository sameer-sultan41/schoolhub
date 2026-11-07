import { listPayments } from "./payments-service";

export const PaymentsService = {
  listPayments,
};
export type { PaymentMethod, PaymentRecord, PaymentsQuery, PaymentStatus } from "./payments-type";
