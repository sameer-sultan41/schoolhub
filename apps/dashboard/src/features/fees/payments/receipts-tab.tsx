"use client";

import { useTranslations } from "next-intl";
import { Receipt } from "lucide-react";

import { SearchInput } from "@/components/search-input";
import { Services } from "@/services";
import {
  RECEIPTS_DEFAULT_SORTING,
  RECEIPTS_LIST_RESOURCE,
  RECEIPTS_PAGE_SIZE,
  RECEIPTS_QUERY_MODULE,
  RECEIPTS_SORT_FIELD,
} from "@/services/modules/receipts/receipts-constant";
import { useCollectionList } from "@/features/fees/shared/use-collection-list";
import { PaymentsListCard } from "./payments-list-card";
import { useReceiptColumns } from "./receipt-columns";

/** No URL filter besides the search: a receipt is found by its number. */
const RECEIPT_URL_FILTERS = {};

/**
 * The Receipts tab: every receipt issued, searched by number, with a PDF or thermal download per
 * row. Read and download with `fees.payment.view`.
 */
export function ReceiptsTab() {
  const t = useTranslations("fees");
  const columns = useReceiptColumns();

  const { list, table, state, hasActiveFilter } = useCollectionList({
    columns,
    queryModule: RECEIPTS_QUERY_MODULE,
    listResource: RECEIPTS_LIST_RESOURCE,
    urlFilters: RECEIPT_URL_FILTERS,
    sortField: RECEIPTS_SORT_FIELD,
    defaultSorting: RECEIPTS_DEFAULT_SORTING,
    pageSize: RECEIPTS_PAGE_SIZE,
    fetchPage: ({ cursor, pageSize, ordering, search }) =>
      Services.receipts.listReceipts({ cursor, pageSize, ordering, search: search || undefined }),
  });

  return (
    <PaymentsListCard
      list={list}
      table={table}
      scope="receipts"
      icon={Receipt}
      hasActiveFilter={hasActiveFilter}
      filters={
        <SearchInput
          value={state.searchInput}
          onChange={state.setSearchInput}
          ariaLabel={t("payments.receipts.list.search")}
          placeholder={t("payments.receipts.list.searchPlaceholder")}
          clearLabel={t("payments.filters.clearSearch")}
        />
      }
    />
  );
}
