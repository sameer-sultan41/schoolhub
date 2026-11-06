"use client";

import { useTranslations } from "next-intl";

import { Toolbar, ToolbarHeading } from "@/app/(app)/shell/toolbar";
import { LEDGER_ACCOUNTS_FILTER_KEYS } from "@/services/modules/ledger-accounts/ledger-accounts-constant";
import { FeesTabs, type FeesTabSpec } from "../shared/fees-tabs";
import { AccountsTab } from "./accounts-tab";

/**
 * `/fees/ledger`: title and the ledger's sub-tabs in `?tab=`. Accounts is the only tab now; the
 * journal joins it later. The page itself is gated on `fees.ledger.view` by the section nav and
 * the API.
 */
export function LedgerHome() {
  const t = useTranslations("fees");

  const tabs: FeesTabSpec[] = [
    { id: "accounts", label: t("ledger.tabs.accounts"), content: <AccountsTab /> },
  ];

  return (
    <>
      <Toolbar>
        <ToolbarHeading title={t("ledger.title")} description={t("ledger.summary")} />
      </Toolbar>
      <FeesTabs
        tabs={tabs}
        label={t("ledger.tabs.label")}
        scopedKeys={LEDGER_ACCOUNTS_FILTER_KEYS}
      />
    </>
  );
}
