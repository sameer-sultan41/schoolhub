"use client";

import { fetchPage } from "@schoolhub/api-client";
import {
  Badge,
  BadgeDot,
  Button,
  Checkbox,
  DataTable,
  type DataTableColumn,
  EmptyState,
  Skeleton,
} from "@schoolhub/ui";
import { isOffsetPagination } from "@schoolhub/types";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { GraduationCap } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApiErrorAlert } from "@/components/api-error-alert";
import { Can } from "@/components/can";
import { FilterBar } from "@/components/filter-bar";
import { PersonCell } from "@/components/person-cell";
import { IdCardBatchAction } from "@/features/students/id-card-batch-action";
import { STUDENTS_PAGE_SIZE } from "@/features/students/student-constants";
import type { StudentRecord, StudentStatus } from "@/features/students/student-types";
import { useTableParams } from "@/hooks/use-table-params";
import { apiClient } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { queryKeys } from "@/lib/query-client";

const STATUSES: StudentStatus[] = ["active", "suspended", "transferred", "withdrawn", "graduated"];

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

  // Filters, sort, page size and page number all live in the URL: a filtered roster is
  // then a link a head of year can send to a form tutor, and Back and a refresh both
  // keep the reader's place — including which page they were on, which the cursor this
  // list used to page by could never put in a shareable link.
  const table = useTableParams({
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

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

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

  // The pager reads the URL, never the envelope. `placeholderData` keeps the previous
  // page on screen while the next one loads, so the envelope still describes the page
  // being replaced — a number that lagged a click by a whole request would read as a
  // control that did not take. The range below comes from that same URL state so the two
  // can never disagree; only `total_count` has to come from the server.
  const pageSize = pagination?.page_size ?? table.pageSize;
  const totalCount = pagination?.total_count ?? 0;
  // Guarded rather than a bare `(page - 1) * size + 1`, which would read "1–0 of 0" on
  // an empty roster.
  const firstRowOnPage = totalCount === 0 ? 0 : (table.page - 1) * pageSize + 1;
  const lastRowOnPage = Math.min(table.page * pageSize, totalCount);

  function toggleRow(id: string, checked: boolean) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  // The header box has three states, not two. It used to have two, and an unticked box
  // sitting above three ticked rows read as "nothing is selected" — the one state the
  // roster is most often actually in. Radix resolves a click on an indeterminate box to
  // `true`, so the dash still means "click to take the rest of the page".
  const selectedOnPageCount = rows.reduce(
    (count, row) => (selectedIds.has(row.id) ? count + 1 : count),
    0,
  );
  const allOnPageSelected = rows.length > 0 && selectedOnPageCount === rows.length;
  const someOnPageSelected = selectedOnPageCount > 0 && !allOnPageSelected;

  const columns: DataTableColumn<StudentRecord>[] = [
    {
      id: "select",
      // Never offered in the columns menu: a roster whose checkboxes are gone can be
      // read and not acted on, and the menu that hid them is the only clue back.
      alwaysVisible: true,
      header: (
        <Checkbox
          label={t("idCards.selectAll")}
          checked={someOnPageSelected ? "indeterminate" : allOnPageSelected}
          onCheckedChange={(checked) => {
            setSelectedIds((current) => {
              const next = new Set(current);
              for (const row of rows) {
                if (checked === true) next.add(row.id);
                else next.delete(row.id);
              }
              return next;
            });
          }}
        />
      ),
      cell: (row) => (
        <Checkbox
          label={t("idCards.selectRow")}
          checked={selectedIds.has(row.id)}
          onCheckedChange={(checked) => {
            toggleRow(row.id, checked === true);
          }}
        />
      ),
      skeleton: <Skeleton className="size-4" />,
    },
    {
      id: "name",
      header: t("columns.name"),
      // Sorts on last_name, which is what the endpoint offers — the cell shows a
      // preferred name when there is one, so the order can look off for a student
      // whose preferred name starts differently; sorting on the displayed string is
      // not on offer, and a
      // control that silently did nothing would be worse.
      sortKey: "last_name",
      // The admission number rides under the name now instead of holding a column of its
      // own: a reader reads the two together anyway, and folding them buys back a whole
      // column's width for the rest of the table.
      cell: (row) => (
        <PersonCell
          name={row.preferred_name || `${row.first_name} ${row.last_name}`}
          secondary={row.admission_number}
        />
      ),
      skeleton: PERSON_SKELETON,
    },
    {
      id: "admissionDate",
      header: t("columns.admissionDate"),
      // `identifier`, not `measure`: a date names a row rather than being a quantity
      // compared down the column, so it takes the figures' face but stays start-aligned.
      numeric: "identifier",
      sortKey: "admission_date",
      cell: (row) => formatDate(row.admission_date, locale),
      skeleton: <Skeleton className="h-4 w-24" />,
    },
    {
      id: "status",
      header: t("columns.status"),
      sortKey: "status",
      // Soft rather than solid: one saturated pill per row, down every row of the page,
      // reads as a wall of colour. The dot keeps the chip legible as a STATUS at a
      // glance now that its fill is only a tint.
      cell: (row) => (
        <Badge variant={getStudentStatusVariant(row.status)} appearance="soft">
          <BadgeDot />
          {t(`status.${row.status}`)}
        </Badge>
      ),
      skeleton: <Skeleton className="h-5 w-20 rounded-full" />,
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Can permission="students.id-card.generate">
          <IdCardBatchAction
            selectedIds={[...selectedIds]}
            onDone={() => {
              setSelectedIds(new Set());
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

      <DataTable
        columns={columns}
        rows={rows}
        getRowId={(row) => row.id}
        caption={t("list.caption")}
        isLoading={isPending}
        // Wide table, scanned down one column rather than read row by row.
        density="compact"
        // The envelope goes into the table's own error slot rather than replacing the
        // whole screen: the filter row above stays usable, so a failed request under a
        // narrow filter can be widened without a reload.
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
        sort={table.sort}
        // The hidden set goes in the URL alongside the filters, so a column layout
        // someone arranged travels with the link rather than staying on their machine.
        columnVisibility={{
          hidden: table.hiddenColumns,
          onChange: table.setHiddenColumns,
          triggerLabel: tCommon("columns"),
          title: tCommon("toggleColumns"),
        }}
        pagination={{
          mode: "pages",
          page: table.page,
          // 0 until the first response lands, which is what leaves the pager absent
          // under the loading skeleton rather than showing a lone disabled "1".
          totalPages: pagination?.total_pages ?? 0,
          onPageChange: table.setPage,
          label: tCommon("pagination"),
          previousLabel: tCommon("previousPage"),
          nextLabel: tCommon("nextPage"),
          goToPageLabel: (page) => tCommon("goToPage", { page }),
          morePagesLabel: tCommon("morePages"),
          pageSize: {
            value: table.pageSize,
            options: [25, 50, 100],
            onChange: table.setPageSize,
            label: tCommon("rowsPerPage"),
          },
          // "1–25 of 284" rather than the bare total this showed under cursor paging:
          // with a page number on screen, where the reader is in the roll is finally a
          // fact the summary can state.
          // Suppressed on an empty result: the range would read "1–0 of 0" beneath an
          // empty state that has already said there is nothing here.
          summary:
            pagination && pagination.total_count > 0
              ? tCommon("pageRange", {
                  from: firstRowOnPage,
                  to: lastRowOnPage,
                  count: pagination.total_count,
                })
              : null,
        }}
      />
    </div>
  );
}
