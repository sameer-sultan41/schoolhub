"use client";

import { useQuery } from "@tanstack/react-query";

import { queryKeys } from "@/lib/query-client";
import { Services, type FeeStructureStatus, type LedgerAccountType } from "@/services";
import {
  LEDGER_ACCOUNTS_OPTIONS_RESOURCE,
  LEDGER_ACCOUNTS_QUERY_MODULE,
} from "@/services/modules/ledger-accounts/ledger-accounts-constant";
import {
  FEE_STRUCTURES_OPTIONS_RESOURCE,
  FEE_STRUCTURES_QUERY_MODULE,
} from "@/services/modules/fee-structures/fee-structures-constant";
import {
  FEE_HEADS_OPTIONS_RESOURCE,
  FEE_HEADS_QUERY_MODULE,
} from "@/services/modules/fee-heads/fee-heads-constant";

import {
  EXPENSE_CATEGORIES_OPTIONS_RESOURCE,
  EXPENSE_CATEGORIES_QUERY_MODULE,
} from "@/services/modules/expense-categories/expense-categories-constant";

/**
 * The lists a picker or a name lookup reads: every record, one cache entry per filter set. A write to the module invalidates them with its lists.
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
    queryFn: () => Services.ledgerAccounts.fetchLedgerAccountOptions({ accountType, isActive }),
    enabled,
  });
}

export function useFeeHeadOptions({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: queryKeys.list(FEE_HEADS_QUERY_MODULE, FEE_HEADS_OPTIONS_RESOURCE),
    queryFn: () => Services.feeHeads.fetchFeeHeadOptions(),
    enabled,
  });
}

/** Every fee structure (of one status, if given), with its session: a picker offers them, and a name lookup reads them. */
export function useFeeStructureOptions({
  status,
  enabled = true,
}: { status?: FeeStructureStatus; enabled?: boolean } = {}) {
  return useQuery({
    queryKey: queryKeys.list(FEE_STRUCTURES_QUERY_MODULE, FEE_STRUCTURES_OPTIONS_RESOURCE, {
      status,
    }),
    queryFn: () => Services.feeStructures.fetchFeeStructureOptions(status),
    enabled,
  });
}

/** Every expense category (only the active ones with `isActive: true`, for a picker): read with `fees.expense.view`. */
export function useExpenseCategoryOptions({
  isActive,
  enabled = true,
}: { isActive?: boolean; enabled?: boolean } = {}) {
  return useQuery({
    queryKey: queryKeys.list(EXPENSE_CATEGORIES_QUERY_MODULE, EXPENSE_CATEGORIES_OPTIONS_RESOURCE, {
      isActive,
    }),
    queryFn: () => Services.expenseCategories.fetchExpenseCategoryOptions({ isActive }),
    enabled,
  });
}
