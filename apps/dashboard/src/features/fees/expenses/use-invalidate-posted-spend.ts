"use client";

import { useInvalidateModule } from "@/hooks/use-invalidate-module";
import { BUDGETS_QUERY_MODULE } from "@/services/modules/budgets/budgets-constant";
import { LEDGER_ENTRIES_QUERY_MODULE } from "@/services/modules/ledger-entries/ledger-entries-constant";

/**
 * After an expense posts to the ledger or is reversed (Approve, Reverse): the journal gains lines,
 * and the budgets' variance reads move with them. The expenses' own list is invalidated by the
 * dialog, as every transition does.
 */
export function useInvalidatePostedSpend() {
  const invalidateLedger = useInvalidateModule(LEDGER_ENTRIES_QUERY_MODULE);
  const invalidateBudgets = useInvalidateModule(BUDGETS_QUERY_MODULE);

  return () => {
    invalidateLedger();
    invalidateBudgets();
  };
}
