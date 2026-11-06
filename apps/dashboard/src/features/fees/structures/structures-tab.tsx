"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { getCoreRowModel, useReactTable } from "@tanstack/react-table";
import { EmptyState } from "@schoolhub/ui";
import { Layers } from "lucide-react";

import { CursorDataGridCard } from "@/components/cursor-data-grid-card";
import { feeStructurePath } from "@/config/paths";
import { useCurrentUser } from "@/hooks/use-current-user";
import { useCursorList } from "@/hooks/use-cursor-list";
import { hideableColumnIds, useDataGridUrlState } from "@/hooks/use-data-grid-url-state";
import { FILTER_ALL } from "@/lib/constants";
import { toOrdering } from "@/lib/helpers";
import { hasPermission } from "@/lib/permissions";
import { queryKeys } from "@/lib/query-client";
import { Services, type FeeStructureRecord } from "@/services";
import {
  FEE_STRUCTURES_DEFAULT_SORTING,
  FEE_STRUCTURES_LIST_RESOURCE,
  FEE_STRUCTURES_PAGE_SIZE,
  FEE_STRUCTURES_QUERY_MODULE,
  FEE_STRUCTURES_SORT_FIELD,
  FEE_STRUCTURES_SORTABLE_IDS,
  FEE_STRUCTURES_URL_FILTERS,
} from "@/services/modules/fee-structures/fee-structures-constant";
import { feeStructureStatusFilter } from "@/services/modules/fee-structures/fee-structures-helper";
import { FeesTabHeader } from "../shared/fees-tab-header";
import { useStructureReferences } from "../shared/use-structure-references";
import { useStructureColumns } from "./structure-columns";
import { StructureFilters } from "./structure-filters";
import { StructureFormDialog } from "./structure-form-dialog";

type FormTarget = { record?: FeeStructureRecord };

/**
 * The Structures tab of `/fees/structures`: cursor-paged, filtered in the URL by session, class,
 * campus and status. New follows `fees.fee-structure.create` and opens the new draft's page;
 * Edit follows `.update` and a draft status. Each dialog is mounted only while open.
 */
export function StructuresTab() {
  const t = useTranslations("fees");
  const router = useRouter();

  const [formTarget, setFormTarget] = useState<FormTarget | null>(null);

  const { data: user } = useCurrentUser();
  const canCreate = hasPermission(user, "fees.fee-structure.create");
  const canUpdate = hasPermission(user, "fees.fee-structure.update");
  const { names } = useStructureReferences();

  // Stable, so the columns' own `useMemo` skips a rebuild on a keystroke or a page change.
  const handleEdit = useCallback((record: FeeStructureRecord) => {
    setFormTarget({ record });
  }, []);

  const columns = useStructureColumns({ canUpdate, names, onEdit: handleEdit });
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
    filters: FEE_STRUCTURES_URL_FILTERS,
    sortableIds: FEE_STRUCTURES_SORTABLE_IDS,
    defaultSorting: FEE_STRUCTURES_DEFAULT_SORTING,
    hideableIds,
    trimSearch: true,
  });
  const hasActiveFilter =
    search !== "" ||
    filters.session !== "" ||
    filters.class !== "" ||
    filters.campus !== "" ||
    filters.status !== FILTER_ALL;
  const ordering = toOrdering(sorting, FEE_STRUCTURES_SORT_FIELD);

  const list = useCursorList({
    // A cursor is good only for the query that issued it: any filter or sort change starts over.
    resetKey: [
      search,
      ordering,
      filters.session,
      filters.class,
      filters.campus,
      filters.status,
    ].join("|"),
    queryKey: (cursor) =>
      queryKeys.list(FEE_STRUCTURES_QUERY_MODULE, FEE_STRUCTURES_LIST_RESOURCE, {
        cursor,
        search,
        ordering,
        ...filters,
      }),
    queryFn: (cursor) =>
      Services.feeStructures.listFeeStructures({
        cursor,
        pageSize: FEE_STRUCTURES_PAGE_SIZE,
        ordering,
        search: search || undefined,
        academicSessionId: filters.session || undefined,
        classId: filters.class || undefined,
        campusId: filters.campus || undefined,
        status: feeStructureStatusFilter(filters.status),
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

  return (
    <>
      <FeesTabHeader
        createLabel={t("structures.actions.create")}
        onCreate={
          canCreate
            ? () => {
                setFormTarget({});
              }
            : undefined
        }
      />
      <CursorDataGridCard
        list={list}
        table={table}
        caption={t("structures.list.caption")}
        paginationLabel={t("structures.list.pagination")}
        loadErrorMessage={t("structures.list.loadError")}
        filters={
          <StructureFilters
            searchInput={searchInput}
            onSearchInputChange={setSearchInput}
            values={filters}
            onChange={setFilters}
          />
        }
        emptyState={
          <EmptyState
            icon={Layers}
            title={t(hasActiveFilter ? "structures.list.noMatches" : "structures.list.emptyTitle")}
            description={t(
              hasActiveFilter
                ? "structures.list.noMatchesDescription"
                : "structures.list.emptyDescription",
            )}
          />
        }
      />
      {formTarget && (
        <StructureFormDialog
          open
          onOpenChange={(open) => {
            if (!open) setFormTarget(null);
          }}
          record={formTarget.record}
          onCreated={(created) => {
            router.push(feeStructurePath(created.id));
          }}
        />
      )}
    </>
  );
}
