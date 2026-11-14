"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { EmptyState } from "@schoolhub/ui";
import { ScrollText } from "lucide-react";

import { CursorDataGridCard } from "@/components/cursor-data-grid-card";
import { useCurrentUser } from "@/hooks/use-current-user";
import { hasPermission } from "@/lib/permissions";
import { Services } from "@/services";
import {
  LEDGER_ENTRIES_DEFAULT_SORTING,
  LEDGER_ENTRIES_LIST_RESOURCE,
  LEDGER_ENTRIES_PAGE_SIZE,
  LEDGER_ENTRIES_QUERY_MODULE,
  LEDGER_ENTRIES_SORT_FIELD,
  LEDGER_ENTRIES_URL_FILTERS,
} from "@/services/modules/ledger-entries/ledger-entries-constant";
import { referenceTypeFilter } from "@/services/modules/ledger-entries/ledger-entries-helper";
import { FeesTabHeader } from "@/features/fees/shared/fees-tab-header";
import { useCollectionList } from "@/features/fees/shared/use-collection-list";
import { useLedgerAccountOptions } from "@/features/fees/shared/use-fee-options";
import { JournalFilters } from "./journal-filters";
import { useJournalColumns } from "./journal-columns";
import { PostJournalDialog } from "./post-journal-dialog";

/**
 * The Ledger → Journal tab: every posting line, cursor-paged and filtered in the URL by account,
 * reference type and an entry-date range (plain days: the server's `entry_date` is a date
 * column). **Post journal** follows `fees.ledger.create`; the ledger is otherwise read-only, and
 * a mistake is corrected by a new, offsetting entry. The dialog is mounted only while open.
 */
export function JournalTab() {
  const t = useTranslations("fees");
  const { data: user } = useCurrentUser();
  const canPost = hasPermission(user, "fees.ledger.create");
  const [posting, setPosting] = useState(false);

  const columns = useJournalColumns();
  const accountsQuery = useLedgerAccountOptions();

  const { list, table, state, hasActiveFilter } = useCollectionList({
    columns,
    queryModule: LEDGER_ENTRIES_QUERY_MODULE,
    listResource: LEDGER_ENTRIES_LIST_RESOURCE,
    urlFilters: LEDGER_ENTRIES_URL_FILTERS,
    sortField: LEDGER_ENTRIES_SORT_FIELD,
    defaultSorting: LEDGER_ENTRIES_DEFAULT_SORTING,
    pageSize: LEDGER_ENTRIES_PAGE_SIZE,
    fetchPage: ({ cursor, pageSize, ordering, search, filters }) =>
      Services.ledgerEntries.listLedgerEntries({
        cursor,
        pageSize,
        ordering,
        search: search || undefined,
        accountId: filters.account || undefined,
        referenceType: referenceTypeFilter(filters.reference),
        dateFrom: filters.from || undefined,
        dateTo: filters.to || undefined,
      }),
  });

  return (
    <>
      <FeesTabHeader
        createLabel={t("ledger.journal.actions.post")}
        onCreate={
          canPost
            ? () => {
                setPosting(true);
              }
            : undefined
        }
      />
      <CursorDataGridCard
        list={list}
        table={table}
        caption={t("ledger.journal.list.caption")}
        paginationLabel={t("ledger.journal.list.pagination")}
        loadErrorMessage={t("ledger.journal.list.loadError")}
        filters={
          <JournalFilters
            searchInput={state.searchInput}
            onSearchInputChange={state.setSearchInput}
            values={state.filters}
            onChange={state.setFilters}
            accounts={(accountsQuery.data ?? []).map((account) => ({
              id: account.id,
              name: `${account.code} ${account.name}`,
            }))}
          />
        }
        emptyState={
          <EmptyState
            icon={ScrollText}
            title={t(
              hasActiveFilter ? "ledger.journal.list.noMatches" : "ledger.journal.list.emptyTitle",
            )}
            description={t(
              hasActiveFilter
                ? "ledger.journal.list.noMatchesDescription"
                : "ledger.journal.list.emptyDescription",
            )}
          />
        }
      />
      {posting && (
        <PostJournalDialog
          open
          onOpenChange={(open) => {
            if (!open) setPosting(false);
          }}
        />
      )}
    </>
  );
}
