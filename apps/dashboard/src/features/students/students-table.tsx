"use client";

import { fetchPage } from "@schoolhub/api-client";
import {
  Badge,
  BadgeDot,
  Button,
  createSelectColumn,
  DataGridCard,
  DataGridColumnHeader,
  EmptyState,
  Skeleton,
} from "@schoolhub/ui";
import { isOffsetPagination } from "@schoolhub/types";
import type { DragEndEvent } from "@dnd-kit/core";
import { arrayMove } from "@dnd-kit/sortable";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  type ColumnDef,
  type ColumnPinningState,
  getCoreRowModel,
  type RowSelectionState,
  useReactTable,
} from "@tanstack/react-table";
import { GraduationCap } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ApiErrorAlert } from "@/components/api-error-alert";
import { Can } from "@/components/can";
import { FilterBar } from "@/components/filter-bar";
import { PersonCell } from "@/components/person-cell";
import { IdCardBatchAction } from "@/features/students/id-card-batch-action";
import { STUDENTS_PAGE_SIZE } from "@/features/students/student-constants";
import type { StudentRecord, StudentStatus } from "@/features/students/student-types";
import { useDataGridLabels } from "@/hooks/use-data-grid-labels";
import { useDataGridTableParams } from "@/hooks/use-data-grid-table-params";
import { apiClient } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { queryKeys } from "@/lib/query-client";

const STATUSES: StudentStatus[] = ["active", "suspended", "transferred", "withdrawn", "graduated"];

/** The house convention for "no value" — see AGENTS.md's cell vocabulary. */
const EMPTY = "—";

/** Column ids double as the server's `sort_by` values (see `useDataGridTableParams`'s own
 * header comment) — so "name" is `last_name`, "campus" is `campus_name`, and so on, the
 * same fields `DataTable`'s old `sortKey` named explicitly. */
const COLUMN_ORDER = [
  "select",
  "last_name",
  "campus_name",
  "house_name",
  "admission_date",
  "status",
];

/** The DataTable-era column ids, mapped to what they became when this table adopted
 * TanStack Table and its ids started doubling as sort_by values. A `?hidden=` link
 * bookmarked before that migration still names the OLD ids — without translating them
 * on the way in, they match no real column and the reader's hidden columns come back
 * silently. Sort was unaffected: the old DataTable's `sortKey` for each of these was
 * ALREADY the new id, so only column-visibility persistence needs this. */
const LEGACY_COLUMN_IDS: Record<string, string> = {
  name: "last_name",
  campus: "campus_name",
  house: "house_name",
  admissionDate: "admission_date",
};

/**
 * The badge variant a student's status wears.
 *
 * A function rather than the `Record` this used to be so it can be imported and asserted
 * on its own: the mapping is a product decision — withdrawn is a failure state, a
 * transfer is not — and a test that pins it should not have to render a whole table to
 * reach it.
 *
 * A `switch` rather than a lookup object because the annotated return type then makes
 * exhaustiveness a compile error: a sixth `StudentStatus` fails the build here instead
 * of rendering an undefined variant.
 */
export function getStudentStatusVariant(
  status: StudentStatus,
): "secondary" | "success" | "warning" | "danger" {
  switch (status) {
    case "active":
      return "success";
    case "suspended":
      return "warning";
    case "withdrawn":
      return "danger";
    // Neither of these is a problem to flag: one moved to another school, one finished.
    case "transferred":
    case "graduated":
      return "secondary";
  }
}

/**
 * Mirrors `PersonCell`'s shape — a 32px disc and the two lines beside it.
 *
 * The default skeleton is a single bar one line tall, so the table would jump by the
 * difference the moment rows arrived, which reads as a glitch rather than as loading.
 */
const PERSON_SKELETON = (
  <div className="flex items-center gap-2.5">
    <Skeleton className="size-8 rounded-full" />
    <div className="flex flex-col gap-1.5">
      <Skeleton className="h-4 w-28" />
      <Skeleton className="h-3 w-16" />
    </div>
  </div>
);

/** Sentinel for "no status filter" in the Select — kept out of the request params
 * entirely rather than sent as an empty string, so `{}` and `{status: ""}` are the
 * same cache key. */
const ALL_STATUSES = "__all__";

export function StudentsTable() {
  const t = useTranslations("students");
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const labels = useDataGridLabels();

  // Filters, sort, page size and page number all live in the URL: a filtered roster is
  // then a link a head of year can send to a form tutor, and Back and a refresh both
  // keep the reader's place — including which page they were on, which the cursor this
  // list used to page by could never put in a shareable link.
  const table = useDataGridTableParams({
    filterKeys: ["status"],
    searchable: true,
    pageSize: STUDENTS_PAGE_SIZE,
    sortLabels: {
      ascending: (column) => tCommon("sortAscending", { column }),
      descending: (column) => tCommon("sortDescending", { column }),
    },
  });
  // FilterBar owns the draft the reader is typing and the debounce that commits it;
  // what lands here is the committed term.
  const status = table.filter("status");

  // Column order and pinning stay local — neither is persisted anywhere in the Metronic
  // reference this grid was adapted from either (see `useDataGridTableParams`'s own
  // header comment for why that's a deliberate scope line, not an oversight).
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [columnPinning, setColumnPinning] = useState<ColumnPinningState>({});
  const [columnOrder, setColumnOrder] = useState<string[]>(COLUMN_ORDER);

  // Carries `page` already, whenever the reader is past the first one, so the request
  // and the cache key both follow the pager without either of them restating it.
  const filters = table.query;

  const { data, isPending, error } = useQuery({
    queryKey: queryKeys.list("students", "students", filters),
    queryFn: () => fetchPage<StudentRecord>(apiClient, "/students", { query: filters }),
    placeholderData: keepPreviousData,
  });

  const rows = data?.items ?? [];
  // /students pages by number now, not by cursor: `meta.pagination` is
  // `{page, page_size, total_count, total_pages}`. `fetchPage` is generic over every
  // endpoint so it types `Page.pagination` as the union — narrow it here rather than
  // assuming the shape.
  const pagination =
    data?.pagination && isOffsetPagination(data.pagination) ? data.pagination : undefined;
  const totalCount = pagination?.total_count ?? 0;

  const selectedIds = Object.keys(rowSelection).filter((id) => rowSelection[id]);

  // Translates any legacy ids a bookmarked pre-migration link still carries — see
  // LEGACY_COLUMN_IDS's own comment. `table.columnVisibility` only ever lists HIDDEN
  // columns (an id absent from it defaults to visible), so remapping keys is enough.
  const columnVisibility = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(table.columnVisibility).map(([id, visible]) => [
          LEGACY_COLUMN_IDS[id] ?? id,
          visible,
        ]),
      ),
    [table.columnVisibility],
  );

  // Memoized, not rebuilt on every render: `flexRender` calls each column's `cell`/
  // `header` AS the React component it renders, so a fresh function identity here is a
  // fresh component TYPE on every render — React remounts the whole cell subtree
  // (including the checkbox) instead of re-rendering it, which loses the DOM node a test
  // (or a real click handler holding a ref) is still holding on to. Every future
  // DataGrid migration needs the same `useMemo`, not just this one.
  const columns: ColumnDef<StudentRecord>[] = useMemo(
    () => [
      createSelectColumn<StudentRecord>({
        selectAll: t("idCards.selectAll"),
        selectRow: t("idCards.selectRow"),
        skeleton: <Skeleton className="size-4" />,
      }),
      {
        id: "last_name",
        header: ({ column }) => <DataGridColumnHeader column={column} title={t("columns.name")} />,
        // The admission number rides under the name now instead of holding a column of its
        // own: a reader reads the two together anyway, and folding them buys back a whole
        // column's width for the rest of the table.
        cell: ({ row }) => (
          <PersonCell
            name={
              row.original.preferred_name || `${row.original.first_name} ${row.original.last_name}`
            }
            secondary={row.original.admission_number}
          />
        ),
        meta: { headerTitle: t("columns.name"), skeleton: PERSON_SKELETON },
      },
      {
        id: "campus_name",
        header: ({ column }) => <DataGridColumnHeader column={column} title={t("fields.campus")} />,
        // The name comes down on the row itself — the list serializer sends `campus_name`
        // beside `campus_id` — so this costs no second request and no lookup map, which
        // is what a column of raw UUIDs was worth avoiding.
        cell: ({ row }) => row.original.campus_name,
        meta: { headerTitle: t("fields.campus"), skeleton: <Skeleton className="h-4 w-28" /> },
      },
      {
        id: "house_name",
        header: ({ column }) => <DataGridColumnHeader column={column} title={t("fields.house")} />,
        // A student need not be in a house. The dash says "none", where an empty cell
        // reads as a rendering fault.
        cell: ({ row }) => row.original.house_name ?? EMPTY,
        meta: { headerTitle: t("fields.house"), skeleton: <Skeleton className="h-4 w-20" /> },
      },
      {
        id: "admission_date",
        header: ({ column }) => (
          <DataGridColumnHeader column={column} title={t("columns.admissionDate")} />
        ),
        cell: ({ row }) => formatDate(row.original.admission_date, locale),
        meta: {
          headerTitle: t("columns.admissionDate"),
          // An identifier, not a measure — a date names a row rather than being a quantity
          // compared down the column — but still figures, so it keeps the numeric face and
          // tabular digits every figure in this app wears (DESIGN.md), matching the
          // admission number right above it in the name column.
          cellClassName: "font-numeric tabular-nums",
          skeleton: <Skeleton className="h-4 w-24" />,
        },
      },
      {
        id: "status",
        header: ({ column }) => (
          <DataGridColumnHeader column={column} title={t("columns.status")} />
        ),
        // Soft rather than solid: one saturated pill per row, down every row of the page,
        // reads as a wall of colour. The dot keeps the chip legible as a STATUS at a
        // glance now that its fill is only a tint.
        cell: ({ row }) => (
          <Badge variant={getStudentStatusVariant(row.original.status)} appearance="soft">
            <BadgeDot />
            {t(`status.${row.original.status}`)}
          </Badge>
        ),
        meta: {
          headerTitle: t("columns.status"),
          skeleton: <Skeleton className="h-5 w-20 rounded-full" />,
        },
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `t` is next-intl's translator, not memoized by that library itself; re-deriving columns on every message-catalog/locale change (not on every render) is the actual intent here.
    [locale],
  );

  const reactTable = useReactTable({
    data: rows,
    columns,
    getRowId: (row) => row.id,
    getCoreRowModel: getCoreRowModel(),
    manualSorting: true,
    manualPagination: true,
    manualFiltering: true,
    pageCount: pagination?.total_pages ?? -1,
    columnResizeMode: "onChange",
    enableRowSelection: true,
    state: {
      sorting: table.sorting,
      pagination: table.pagination,
      columnVisibility,
      rowSelection,
      columnPinning,
      columnOrder,
    },
    onSortingChange: table.onSortingChange,
    onPaginationChange: table.onPaginationChange,
    onColumnVisibilityChange: table.onColumnVisibilityChange,
    onRowSelectionChange: setRowSelection,
    onColumnPinningChange: setColumnPinning,
    onColumnOrderChange: setColumnOrder,
  });

  function handleColumnDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setColumnOrder((current) => {
      const oldIndex = current.indexOf(active.id as string);
      const newIndex = current.indexOf(over.id as string);
      return arrayMove(current, oldIndex, newIndex);
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Can permission="students.id-card.generate">
          <IdCardBatchAction
            selectedIds={selectedIds}
            onDone={() => {
              setRowSelection({});
            }}
          />
        </Can>
        <div className="flex items-center gap-2">
          <Can permission="students.student.import">
            <Button asChild variant="outline" size="sm">
              <Link href="/students/import">{t("actions.import")}</Link>
            </Button>
          </Can>
          <Can permission="students.student.create">
            <Button asChild size="sm">
              <Link href="/students/new">{t("actions.create")}</Link>
            </Button>
          </Can>
        </div>
      </div>

      <DataGridCard
        table={reactTable}
        recordCount={totalCount}
        isLoading={isPending}
        labels={labels}
        caption={t("list.caption")}
        toolbar={
          <FilterBar
            search={{
              label: t("filters.search"),
              placeholder: t("list.searchPlaceholder"),
              value: table.search,
              onChange: table.setSearch,
            }}
            selects={[
              {
                id: "status",
                label: t("filters.status"),
                value: status,
                onChange: (value) => {
                  table.setFilter("status", value);
                },
                options: STATUSES.map((value) => ({ value, label: t(`status.${value}`) })),
                allLabel: t("filters.all"),
                allValue: ALL_STATUSES,
              },
            ]}
            clearLabel={tCommon("clearFilters")}
            onClear={table.clear}
          />
        }
        // The envelope goes into the grid's own error slot rather than replacing the
        // whole screen: the filter row stays usable, so a failed request under a narrow
        // filter can be widened without a reload.
        error={error ? <ApiErrorAlert error={error} /> : undefined}
        emptyState={
          <EmptyState
            icon={GraduationCap}
            title={t("list.emptyTitle")}
            description={t("list.emptyDescription")}
            action={
              <Can permission="students.student.create">
                <Button asChild size="sm">
                  <Link href="/students/new">{t("actions.create")}</Link>
                </Button>
              </Can>
            }
          />
        }
        onRowClick={(row) => {
          router.push(`/students/${row.id}`);
        }}
        // Wide table, scanned down one column rather than read row by row.
        tableLayout={{
          dense: true,
          columnsVisibility: true,
          columnsResizable: true,
          columnsPinnable: true,
          columnsMovable: true,
          columnsDraggable: true,
        }}
        onColumnDragEnd={handleColumnDragEnd}
        pageSizes={[25, 50, 100]}
      />
    </div>
  );
}
