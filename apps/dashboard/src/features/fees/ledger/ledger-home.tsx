"use client";

import { useTranslations } from "next-intl";

import { Toolbar, ToolbarHeading } from "@/app/(app)/shell/toolbar";
import { LEDGER_ACCOUNTS_FILTER_KEYS } from "@/services/modules/ledger-accounts/ledger-accounts-constant";
import {
  LEDGER_ACCOUNTS_TAB_ID,
  LEDGER_ENTRIES_FILTER_KEYS,
  LEDGER_JOURNAL_TAB_ID,
} from "@/services/modules/ledger-entries/ledger-entries-constant";
import { FeesTabs, type FeesTabSpec } from "@/features/fees/shared/fees-tabs";
import { AccountsTab } from "./accounts-tab";
import { JournalTab } from "./journal-tab";

/**
 * `/fees/ledger`: title and the ledger's sub-tabs, Accounts and Journal, in `?tab=`. Both read
 * with `fees.ledger.view`, the key the page is gated on (the section nav and the API); each
 * tab's writes follow `fees.ledger.create`.
 */
export function LedgerHome() {
  const t = useTranslations("fees");

  const tabs: FeesTabSpec[] = [
    { id: LEDGER_ACCOUNTS_TAB_ID, label: t("ledger.tabs.accounts"), content: <AccountsTab /> },
    { id: LEDGER_JOURNAL_TAB_ID, label: t("ledger.tabs.journal"), content: <JournalTab /> },
  ];

  return (
    <>
      <Toolbar>
        <ToolbarHeading title={t("ledger.title")} description={t("ledger.summary")} />
      </Toolbar>
      <FeesTabs
        tabs={tabs}
        label={t("ledger.tabs.label")}
        scopedKeys={[...LEDGER_ACCOUNTS_FILTER_KEYS, ...LEDGER_ENTRIES_FILTER_KEYS]}
      />
    </>
  );
}
