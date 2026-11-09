"use client";

import { useQuery } from "@tanstack/react-query";

import { queryKeys } from "@/lib/query-client";
import { Services, type ReceiptRecord, type VoucherRecord } from "@/services";
import { PARENT_PORTAL_QUERY_MODULE } from "@/services/modules/parent-portal/parent-portal-constant";
import { fetchAllPages } from "@/features/portal/fetch-all-pages";

const PAGE_SIZE = 100;

/** One child's invoices: the outstanding ones, or the paid ones. The server decides what a
 * guardian may see (no drafts, no canceled). */
export function useChildInvoices(studentId: string | undefined, kind: "outstanding" | "paid") {
  return useQuery({
    queryKey: queryKeys.list(PARENT_PORTAL_QUERY_MODULE, "invoices", { studentId, kind }),
    enabled: studentId !== undefined,
    queryFn: () =>
      fetchAllPages((cursor) =>
        Services.feeInvoices.listFeeInvoices({
          studentId,
          cursor,
          pageSize: PAGE_SIZE,
          ...(kind === "outstanding" ? { outstanding: true } : { status: "paid" as const }),
        }),
      ),
  });
}

/** One child's receipts by invoice number, so a row can offer its own receipts. */
export function useReceiptsByInvoice(studentId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.list(PARENT_PORTAL_QUERY_MODULE, "receipts", { studentId }),
    enabled: studentId !== undefined,
    queryFn: () =>
      fetchAllPages((cursor) =>
        Services.receipts.listReceipts({ student: studentId, cursor, pageSize: PAGE_SIZE }),
      ),
    select: (receipts) => {
      const byInvoice = new Map<string, ReceiptRecord[]>();
      for (const receipt of receipts) {
        byInvoice.set(receipt.invoice_no, [...(byInvoice.get(receipt.invoice_no) ?? []), receipt]);
      }
      return byInvoice;
    },
  });
}

/** One child's unpaid vouchers by invoice id, so an open invoice can offer its own. Void, paid
 * and expired slips are no use to a parent, so only `issued` ones are asked for. */
export function useChildVouchers(studentId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.list(PARENT_PORTAL_QUERY_MODULE, "vouchers", { studentId }),
    enabled: studentId !== undefined,
    queryFn: () =>
      fetchAllPages((cursor) =>
        Services.vouchers.listVouchers({
          student: studentId,
          status: "issued",
          cursor,
          pageSize: PAGE_SIZE,
        }),
      ),
    select: (vouchers) => {
      const byInvoice = new Map<string, VoucherRecord[]>();
      for (const voucher of vouchers) {
        byInvoice.set(voucher.fee_invoice, [
          ...(byInvoice.get(voucher.fee_invoice) ?? []),
          voucher,
        ]);
      }
      return byInvoice;
    },
  });
}
