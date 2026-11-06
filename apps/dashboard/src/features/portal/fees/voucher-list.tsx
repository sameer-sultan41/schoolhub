"use client";

import { useState } from "react";
import { Button } from "@schoolhub/ui";
import { Download } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import { enumLabel } from "@/features/portal/enum-label";
import { formatDate, saveBlob } from "@/lib/helpers";
import { Services, type VoucherRecord } from "@/services";
import { VOUCHER_PROVIDER_LABEL_KEY } from "./voucher-labels";

/** One voucher's PDF. The download carries the bearer token (a bare link would not), so it is
 * fetched as a blob and saved; a failure is said in place and can be tried again. */
function VoucherDownloadButton({ voucher }: { voucher: VoucherRecord }) {
  const t = useTranslations("portal.fees");
  const locale = useLocale();
  const [state, setState] = useState<"idle" | "busy" | "error">("idle");

  async function download() {
    setState("busy");
    try {
      saveBlob(
        await Services.vouchers.downloadVoucher(voucher.id),
        `${voucher.consumer_number}.pdf`,
      );
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
        {t("vouchers.download", {
          provider: enumLabel(t, VOUCHER_PROVIDER_LABEL_KEY, voucher.provider),
          number: voucher.consumer_number,
          date: formatDate(voucher.due_date, locale),
        })}
      </Button>
      {state === "error" ? (
        <span role="alert" className="text-xs text-destructive">
          {t("vouchers.failed")}
        </span>
      ) : null}
    </span>
  );
}

/** The payment slips of one open invoice, or where to get one when there is none. */
export function VoucherList({ vouchers }: { vouchers: readonly VoucherRecord[] }) {
  const t = useTranslations("portal.fees");

  if (vouchers.length === 0) {
    return <p className="text-xs text-muted-foreground">{t("vouchers.empty")}</p>;
  }
  return (
    <div className="flex flex-wrap gap-2">
      {vouchers.map((voucher) => (
        <VoucherDownloadButton key={voucher.id} voucher={voucher} />
      ))}
    </div>
  );
}
