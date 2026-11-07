"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { getCoreRowModel, useReactTable } from "@tanstack/react-table";
import { Button, EmptyState } from "@schoolhub/ui";
import { FileText, Sparkles } from "lucide-react";

import { Toolbar, ToolbarActions, ToolbarHeading } from "@/app/(app)/shell/toolbar";
import { CursorDataGridCard } from "@/components/cursor-data-grid-card";
import { useCurrentUser } from "@/hooks/use-current-user";
import { useCursorList } from "@/hooks/use-cursor-list";
import { hideableColumnIds, useDataGridUrlState } from "@/hooks/use-data-grid-url-state";
import { FILTER_ALL } from "@/lib/constants";
import { toOrdering } from "@/lib/helpers";
import { hasPermission } from "@/lib/permissions";
import { queryKeys } from "@/lib/query-client";
import { Services } from "@/services";
import {
  FEE_INVOICES_DEFAULT_SORTING,
  FEE_INVOICES_LIST_RESOURCE,
  FEE_INVOICES_PAGE_SIZE,
  FEE_INVOICES_QUERY_MODULE,
  FEE_INVOICES_SORT_FIELD,
  FEE_INVOICES_SORTABLE_IDS,
  FEE_INVOICES_URL_FILTERS,
} from "@/services/modules/fee-invoices/fee-invoices-constant";
import {
  feeInvoiceStatusFilter,
  outstandingFilter,
} from "@/services/modules/fee-invoices/fee-invoices-helper";
import { NameLookupProvider, type NameLookups } from "@/features/fees/shared/name-lookup";
import { useInvoiceReferences } from "@/features/fees/shared/use-invoice-references";
import { GenerateInvoicesDialog } from "./generate-invoices-dialog";
import { useInvoiceColumns } from "./invoice-columns";
import { InvoiceFilters } from "./invoice-filters";

type OpenDialog = "generate" | null;

/**
 * `/fees/invoices`: the invoices, cursor-paged and filtered in the URL by session, structure,
 * student and status, with the Defaulters switch (`outstanding=true`). Generate invoices
 * New invoice both follow `fees.invoice.create`. Each dialog is mounted only while open.
 */
export function InvoicesHome() {
  const t = useTranslations("fees");
  const [dialog, setDialog] = useState<OpenDialog>(null);

  const { data: user } = useCurrentUser();
  const canCreate = hasPermission(user, "fees.invoice.create");
  const { names } = useInvoiceReferences();
  const lookups = useMemo<NameLookups>(
    () => ({ sessions: names.sessions, structures: names.structures }),
    [names],
  );

  const columns = useInvoiceColumns();
  const hideableIds = useMemo(() => hideableColumnIds(columns), [columns]);

  const {
    filters,
    setFilters,
    searchInput,
    setSearchInput,
    search,
    sorting,
    onSortingChange,
    columnVisibility,
    onColumnVisibilityChange,
  } = useDataGridUrlState({
    filters: FEE_INVOICES_URL_FILTERS,
    sortableIds: FEE_INVOICES_SORTABLE_IDS,
    defaultSorting: FEE_INVOICES_DEFAULT_SORTING,
    hideableIds,
    trimSearch: true,
  });
  const hasActiveFilter =
    search !== "" ||
    filters.session !== "" ||
    filters.structure !== "" ||
    filters.student !== "" ||
    filters.outstanding !== "" ||
    filters.status !== FILTER_ALL;
  const ordering = toOrdering(sorting, FEE_INVOICES_SORT_FIELD);

  const list = useCursorList({
    // A cursor is good only for the query that issued it: any filter or sort change starts over.
    resetKey: [
      search,
      ordering,
      filters.session,
      filters.structure,
      filters.student,
      filters.status,
      filters.outstanding,
    ].join("|"),
    queryKey: (cursor) =>
      queryKeys.list(FEE_INVOICES_QUERY_MODULE, FEE_INVOICES_LIST_RESOURCE, {
        cursor,
        search,
        ordering,
        ...filters,
      }),
    queryFn: (cursor) =>
      Services.feeInvoices.listFeeInvoices({
        cursor,
        pageSize: FEE_INVOICES_PAGE_SIZE,
        ordering,
        search: search || undefined,
        academicSessionId: filters.session || undefined,
        feeStructureId: filters.structure || undefined,
        studentId: filters.student || undefined,
        status: feeInvoiceStatusFilter(filters.status),
        outstanding: outstandingFilter(filters.outstanding),
      }),
  });

  const table = useReactTable({
    data: list.rows,
    columns,
    state: { sorting, columnVisibility },
    onSortingChange,
    onColumnVisibilityChange,
    manualPagination: true,
    manualSorting: true,
    getRowId: (record) => record.id,
    getCoreRowModel: getCoreRowModel(),
  });

  const close = (open: boolean) => {
    if (!open) setDialog(null);
  };

  return (
    <NameLookupProvider value={lookups}>
      <Toolbar>
        <ToolbarHeading title={t("invoices.title")} description={t("invoices.summary")} />
        {canCreate && (
          <ToolbarActions>
            <Button
              variant="primary"
              onClick={() => {
                setDialog("generate");
              }}
            >
              <Sparkles aria-hidden="true" />
              {t("invoices.actions.generate")}
            </Button>
          </ToolbarActions>
        )}
      </Toolbar>
      <CursorDataGridCard
        list={list}
        table={table}
        caption={t("invoices.list.caption")}
        paginationLabel={t("invoices.list.pagination")}
        loadErrorMessage={t("invoices.list.loadError")}
        filters={
          <InvoiceFilters
            searchInput={searchInput}
            onSearchInputChange={setSearchInput}
            values={filters}
            onChange={setFilters}
          />
        }
        emptyState={
          <EmptyState
            icon={FileText}
            title={t(hasActiveFilter ? "invoices.list.noMatches" : "invoices.list.emptyTitle")}
            description={t(
              hasActiveFilter
                ? "invoices.list.noMatchesDescription"
                : "invoices.list.emptyDescription",
            )}
          />
        }
      />
      {dialog === "generate" && <GenerateInvoicesDialog open onOpenChange={close} />}
    </NameLookupProvider>
  );
}
