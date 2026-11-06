"use client";

import { useState } from "react";
import { Button } from "@schoolhub/ui";
import { Download } from "lucide-react";
import { useTranslations } from "next-intl";

import { saveBlob } from "@/lib/helpers";
import { Services, type ReceiptRecord } from "@/services";

/** One receipt's PDF. The download carries the bearer token (a bare link would not), so it is
 * fetched as a blob and saved; a failure is said in place and can be tried again. */
export function ReceiptDownloadButton({ receipt }: { receipt: ReceiptRecord }) {
  const t = useTranslations("portal.fees");
  const [state, setState] = useState<"idle" | "busy" | "error">("idle");

  async function download() {
    setState("busy");
    try {
      saveBlob(await Services.receipts.downloadReceipt(receipt.id), `${receipt.receipt_no}.pdf`);
      setState("idle");
    } catch {
      setState("error");
    }
  }

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <Button
        variant="outline"
        size="sm"
        disabled={state === "busy"}
        onClick={() => {
          void download();
        }}
      >
        <Download aria-hidden="true" />
        {t("downloadReceipt", { number: receipt.receipt_no })}
      </Button>
      {state === "error" ? (
        <span role="alert" className="text-xs text-destructive">
          {t("receiptFailed")}
        </span>
      ) : null}
    </span>
  );
}
