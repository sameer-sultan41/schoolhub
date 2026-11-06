"use client";

import { useQuery } from "@tanstack/react-query";
import { MAX_PAGE_SIZE } from "@schoolhub/api-client";

import { queryKeys } from "@/lib/query-client";
import { Services, type LedgerAccountType } from "@/services";
import {
  LEDGER_ACCOUNTS_OPTIONS_RESOURCE,
  LEDGER_ACCOUNTS_QUERY_MODULE,
} from "@/services/modules/ledger-accounts/ledger-accounts-constant";
import {
  FEE_HEADS_OPTIONS_RESOURCE,
  FEE_HEADS_QUERY_MODULE,
} from "@/services/modules/fee-heads/fee-heads-constant";

/**
 * The lists a picker or a name lookup reads: the first `MAX_PAGE_SIZE` records, one cache entry
 * per filter set. A write to the module invalidates them with its lists.
 */

export interface LedgerAccountOptionsParams {
  accountType?: LedgerAccountType;
  isActive?: boolean;
  /** Whether to request the list yet (the viewer holds `fees.ledger.view`). Defaults to true. */
  enabled?: boolean;
}

export function useLedgerAccountOptions({
  accountType,
  isActive,
  enabled = true,
}: LedgerAccountOptionsParams = {}) {
  return useQuery({
    queryKey: queryKeys.list(LEDGER_ACCOUNTS_QUERY_MODULE, LEDGER_ACCOUNTS_OPTIONS_RESOURCE, {
      accountType,
      isActive,
    }),
    queryFn: () =>
      Services.ledgerAccounts.listLedgerAccounts({
        accountType,
        isActive,
        ordering: "code",
        pageSize: MAX_PAGE_SIZE,
      }),
    select: (page) => page.items,
    enabled,
  });
}

export function useFeeHeadOptions({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: queryKeys.list(FEE_HEADS_QUERY_MODULE, FEE_HEADS_OPTIONS_RESOURCE),
    queryFn: () => Services.feeHeads.listFeeHeads({ ordering: "code", pageSize: MAX_PAGE_SIZE }),
    select: (page) => page.items,
    enabled,
  });
}
