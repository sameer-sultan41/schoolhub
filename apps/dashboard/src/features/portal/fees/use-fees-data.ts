"use client";

import { useQuery } from "@tanstack/react-query";

import { queryKeys } from "@/lib/query-client";
import { Services, type ReceiptRecord } from "@/services";
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
          ...(kind === "outstanding" ? { outstanding: true } : { status: "paid" }),
        }),
      ),
  });
}

/** The viewer's receipts by invoice number, so a row can offer its own receipts. */
export function useReceiptsByInvoice() {
  return useQuery({
    queryKey: queryKeys.list(PARENT_PORTAL_QUERY_MODULE, "receipts"),
    queryFn: () =>
      fetchAllPages((cursor) => Services.receipts.listReceipts({ cursor, pageSize: PAGE_SIZE })),
    select: (receipts) => {
      const byInvoice = new Map<string, ReceiptRecord[]>();
      for (const receipt of receipts) {
        byInvoice.set(receipt.invoice_no, [...(byInvoice.get(receipt.invoice_no) ?? []), receipt]);
      }
      return byInvoice;
    },
  });
}
