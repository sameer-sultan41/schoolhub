import type { ReceiptFormat, VoucherFormat } from "@/services";

/**
 * The layouts a receipt or voucher streams in (`?format=`), from the generated receipt enum; a
 * format the API gains is a compile error here until it is placed (L32).
 */
export type DocumentLayout = NonNullable<ReceiptFormat>;
// Fails to compile if the voucher's `?format=` ever differs from the receipt's.
const _sameAsVoucher: Record<DocumentLayout, NonNullable<VoucherFormat>> = {
  pdf: "pdf",
  thermal: "thermal",
};
void _sameAsVoucher;
const DOCUMENT_LAYOUTS_SET: Record<DocumentLayout, true> = { pdf: true, thermal: true };
export const DOCUMENT_LAYOUTS = Object.keys(DOCUMENT_LAYOUTS_SET) as DocumentLayout[];
