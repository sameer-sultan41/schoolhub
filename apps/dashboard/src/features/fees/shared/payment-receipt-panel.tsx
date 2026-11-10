"use client";

import { useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { Alert, Button } from "@schoolhub/ui";
import { Printer } from "lucide-react";

import { Paths } from "@/config/paths";
import { useCurrentUser } from "@/hooks/use-current-user";
import { formatMoney } from "@/lib/format-decimal";
import { saveBlob } from "@/lib/helpers";
import { hasPermission } from "@/lib/permissions";
import { Services, type PaymentRecord } from "@/services";
import { DOCUMENT_LAYOUTS, type DocumentLayout } from "./document-layouts";

type PrintFormat = DocumentLayout;

/**
 * What a recorded payment shows: the amount and receipt number, and Print PDF / Print thermal,
 * which stream the receipt with the bearer token and save it. A payment whose receipt id is not
 * there yet says so and points to the payments list (for a holder of `fees.payment.view`).
 */
export function PaymentReceiptPanel({ payment }: { payment: PaymentRecord }) {
  const t = useTranslations("fees");
  const locale = useLocale();
  const { data: user } = useCurrentUser();
  const [busy, setBusy] = useState<PrintFormat | null>(null);
  const [failed, setFailed] = useState(false);
  // The receipt streams from `GET /receipts/{id}/download`, behind `fees.payment.view`: the
  // counter's collector may not hold it (L55), and then sees only that the receipt is issued.
  const canPrint = hasPermission(user, "fees.payment.view");
  const receipt = canPrint ? payment.receipt : null;

  async function print(format: PrintFormat) {
    if (!receipt) return;
    setBusy(format);
    setFailed(false);
    try {
      const blob = await Services.receipts.downloadReceipt(receipt, format);
      saveBlob(blob, `${payment.receipt_no}-${format}.pdf`);
    } catch {
      setFailed(true);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <Alert variant="success">
        {t("counter.receipt.recorded", {
          amount: formatMoney(locale, payment.amount),
          number: payment.receipt_no,
        })}
      </Alert>
      {receipt ? (
        <div className="flex flex-wrap gap-2.5">
          {DOCUMENT_LAYOUTS.map((format) => (
            <Button
              key={format}
              type="button"
              variant="outline"
              isLoading={busy === format}
              loadingLabel={t("counter.receipt.preparing")}
              disabled={busy !== null}
              onClick={() => {
                void print(format);
              }}
            >
              <Printer aria-hidden="true" />
              {t(`counter.receipt.print_${format}`)}
            </Button>
          ))}
        </div>
      ) : canPrint ? (
        <p className="text-sm text-muted-foreground">
          {t("counter.receipt.pending")}{" "}
          <Link href={Paths.FEES_PAYMENTS} className="text-primary hover:underline">
            {t("counter.receipt.openPayments")}
          </Link>
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">{t("counter.receipt.issued")}</p>
      )}
      {failed && <Alert variant="destructive">{t("counter.receipt.failed")}</Alert>}
    </div>
  );
}
