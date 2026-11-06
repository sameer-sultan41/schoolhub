"use client";

import { useTranslations } from "next-intl";

import { PortalDownloadButton } from "@/features/portal/portal-download-button";
import { saveBlob } from "@/lib/helpers";
import { Services, type ReceiptRecord } from "@/services";

/** One receipt's PDF. The download carries the bearer token (a bare link would not), so it is
 * fetched as a blob and saved. */
export function ReceiptDownloadButton({ receipt }: { receipt: ReceiptRecord }) {
  const t = useTranslations("portal.fees");

  return (
    <PortalDownloadButton
      label={t("downloadReceipt", { number: receipt.receipt_no })}
      failedMessage={t("receiptFailed")}
      download={async () => {
        saveBlob(await Services.receipts.downloadReceipt(receipt.id), `${receipt.receipt_no}.pdf`);
      }}
    />
  );
}
