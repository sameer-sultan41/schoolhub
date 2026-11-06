"use client";

import { useLocale, useTranslations } from "next-intl";

import { enumLabel } from "@/features/portal/enum-label";
import { PortalDownloadButton } from "@/features/portal/portal-download-button";
import { formatDate, saveBlob } from "@/lib/helpers";
import { Services, type VoucherRecord } from "@/services";
import { VOUCHER_PROVIDER_LABEL_KEY } from "./voucher-labels";

/** One voucher's PDF. The download carries the bearer token (a bare link would not), so it is
 * fetched as a blob and saved. */
function VoucherDownloadButton({ voucher }: { voucher: VoucherRecord }) {
  const t = useTranslations("portal.fees");
  const locale = useLocale();

  return (
    <PortalDownloadButton
      label={t("vouchers.download", {
        provider: enumLabel(t, VOUCHER_PROVIDER_LABEL_KEY, voucher.provider),
        number: voucher.consumer_number,
        date: formatDate(voucher.due_date, locale),
      })}
      failedMessage={t("vouchers.failed")}
      download={async () => {
        saveBlob(
          await Services.vouchers.downloadVoucher(voucher.id),
          `${voucher.consumer_number}.pdf`,
        );
      }}
    />
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
