import { downloadVoucher, issueVoucher, listVouchers, voidVoucher } from "./vouchers-service";

export const VouchersService = {
  listVouchers,
  downloadVoucher,
  issueVoucher,
  voidVoucher,
};
export type {
  IssueVoucherInput,
  VoucherFormat,
  VoucherProvider,
  VoucherRecord,
  VoucherStatus,
  VouchersQuery,
} from "./vouchers-type";
