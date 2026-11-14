"use client";

import { useTranslations } from "next-intl";

import { Toolbar, ToolbarHeading } from "@/app/(app)/shell/toolbar";
import { FeesTabs, type FeesTabSpec } from "@/features/fees/shared/fees-tabs";
import {
  PAYMENTS_TAB_ID,
  PAYMENTS_URL_FILTER_KEYS,
  RECEIPTS_TAB_ID,
  REFUNDS_TAB_ID,
  SETTLEMENT_IMPORTS_TAB_ID,
  VOUCHERS_TAB_ID,
} from "./payments-constant";
import { PaymentsTab } from "./payments-tab";
import { ReceiptsTab } from "./receipts-tab";
import { RefundsTab } from "./refunds-tab";
import { SettlementImportsTab } from "./settlement-imports-tab";
import { VouchersTab } from "./vouchers-tab";

/**
 * `/fees/payments`: title and the sub-tabs Payments, Receipts, Vouchers, Refunds and Settlement
 * imports, in `?tab=`. The five lists read behind one key, `fees.payment.view`, which is also
 * the section's gate, so a viewer who reaches the page may open every tab; each write control
 * inside them follows its own key.
 */
export function PaymentsHome() {
  const t = useTranslations("fees");

  const tabs: FeesTabSpec[] = [
    { id: PAYMENTS_TAB_ID, label: t("payments.tabs.payments"), content: <PaymentsTab /> },
    { id: RECEIPTS_TAB_ID, label: t("payments.tabs.receipts"), content: <ReceiptsTab /> },
    { id: VOUCHERS_TAB_ID, label: t("payments.tabs.vouchers"), content: <VouchersTab /> },
    { id: REFUNDS_TAB_ID, label: t("payments.tabs.refunds"), content: <RefundsTab /> },
    {
      id: SETTLEMENT_IMPORTS_TAB_ID,
      label: t("payments.tabs.imports"),
      content: <SettlementImportsTab />,
    },
  ];

  return (
    <>
      <Toolbar>
        <ToolbarHeading title={t("payments.title")} description={t("payments.summary")} />
      </Toolbar>
      <FeesTabs
        tabs={tabs}
        label={t("payments.tabs.label")}
        scopedKeys={PAYMENTS_URL_FILTER_KEYS}
      />
    </>
  );
}
