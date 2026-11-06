import { downloadVoucher, listVouchers } from "./vouchers-service";

export const VouchersService = {
  listVouchers,
  downloadVoucher,
};
export type { VoucherFormat, VoucherRecord, VoucherStatus, VouchersQuery } from "./vouchers-type";
