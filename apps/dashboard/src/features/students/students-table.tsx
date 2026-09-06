"use client";

import { fetchPage } from "@schoolhub/api-client";
import { Badge, Button, DataTable, type DataTableColumn, EmptyState } from "@schoolhub/ui";
import { isCursorPagination } from "@schoolhub/types";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { GraduationCap } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ApiErrorAlert } from "@/components/api-error-alert";
import { Can } from "@/components/can";
import { FilterBar } from "@/components/filter-bar";
import { IdCardBatchAction } from "@/features/students/id-card-batch-action";
import { STUDENTS_PAGE_SIZE } from "@/features/students/student-constants";
import type { StudentRecord, StudentStatus } from "@/features/students/student-types";
import { useCursorPager } from "@/hooks/use-cursor-pager";
import { apiClient } from "@/lib/auth";
import { queryKeys } from "@/lib/query-client";

const STATUSES: StudentStatus[] = ["active", "suspended", "transferred", "withdrawn", "graduated"];

const STATUS_BADGE_VARIANT: Record<StudentStatus, "secondary" | "success" | "warning" | "danger"> =
  {
    active: "success",
    suspended: "warning",
    transferred: "secondary",
    withdrawn: "danger",
    graduated: "secondary",
  };

/** Sentinel for "no status filter" in the Select — kept out of the request params
 * entirely rather than sent as an empty string, so `{}` and `{status: ""}` are the
 * same cache key. */
const ALL_STATUSES = "__all__";

export function StudentsTable() {
  const t = useTranslations("students");
  const tCommon = useTranslations("common");
  const router = useRouter();
  const pager = useCursorPager();

  const [status, setStatus] = useState<StudentStatus | typeof ALL_STATUSES>(ALL_STATUSES);
  // The COMMITTED search term only. FilterBar owns the draft the user is typing and the
  // debounce that turns one into the other — this is what lands in the query key.
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // Only the three fields StudentViewSet declares in `ordering_fields`; asking for
  // anything else is silently ignored by DRF, which would look like a broken control.
  const [sort, setSort] = useState<{ key: string; direction: "asc" | "desc" } | null>(null);
  const [pageSize, setPageSize] = useState(STUDENTS_PAGE_SIZE);

  const filters = useMemo(
    () => ({
      ...(status !== ALL_STATUSES ? { status } : {}),
      ...(search ? { search } : {}),
      // DRF's OrderingFilter spelling: a leading "-" is descending.
      ...(sort ? { ordering: sort.direction === "desc" ? `-${sort.key}` : sort.key } : {}),
      page_size: pageSize,
    }),
    [status, search, sort, pageSize],
  );
  pager.syncFilterKey(JSON.stringify(filters));

  const { data, isPending, isFetching, error } = useQuery({
    queryKey: queryKeys.list("students", "students", { ...filters, cursor: pager.cursor }),
    queryFn: () =>
      fetchPage<StudentRecord>(apiClient, "/students", {
        query: {
          ...filters,
          ...(pager.cursor ? { cursor: pager.cursor } : {}),
        },
      }),
    placeholderData: keepPreviousData,
  });

  const rows = data?.items ?? [];
  // /students paginates by cursor, never offset, but the API-client types
  // `Page.pagination` as `Pagination` (the union) since fetchPage is generic
  // over any endpoint — narrow it here rather than widening useCursorPager to
  // accept a type it can't actually use.
  const pagination =
    data?.pagination && isCursorPagination(data.pagination) ? data.pagination : undefined;

  function toggleRow(id: string, checked: boolean) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  const allOnPageSelected = rows.length > 0 && rows.every((row) => selectedIds.has(row.id));

  const columns: DataTableColumn<StudentRecord>[] = [
    {
      id: "select",
      header: (
        <input
          type="checkbox"
          aria-label={t("idCards.selectAll")}
          checked={allOnPageSelected}
          onChange={(event) => {
            setSelectedIds((current) => {
              const next = new Set(current);
              for (const row of rows) {
                if (event.target.checked) next.add(row.id);
                else next.delete(row.id);
              }
              return next;
            });
          }}
        />
      ),
      cell: (row) => (
        <input
          type="checkbox"
          aria-label={t("idCards.selectRow")}
          checked={selectedIds.has(row.id)}
          onChange={(event) => {
            toggleRow(row.id, event.target.checked);
          }}
        />
      ),
    },
    {
      id: "admissionNumber",
      header: t("columns.admissionNumber"),
      numeric: "identifier",
      cell: (row) => row.admission_number,
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
      cell: (row) => row.preferred_name || `${row.first_name} ${row.last_name}`,
    },
    {
      id: "status",
      header: t("columns.status"),
      cell: (row) => (
        <Badge variant={STATUS_BADGE_VARIANT[row.status]}>{t(`status.${row.status}`)}</Badge>
      ),
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
          value: search,
          onChange: setSearch,
        }}
        selects={[
          {
            id: "status",
            label: t("filters.status"),
            value: status,
            onChange: (value) => {
              setStatus(value as typeof status);
            },
            options: STATUSES.map((value) => ({ value, label: t(`status.${value}`) })),
            allLabel: t("filters.all"),
            allValue: ALL_STATUSES,
          },
        ]}
        clearLabel={tCommon("clearFilters")}
        onClear={() => {
          setSearch("");
          setStatus(ALL_STATUSES);
        }}
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
        sort={{
          activeKey: sort?.key ?? null,
          direction: sort?.direction ?? "asc",
          onChange: (key, direction) => {
            setSort({ key, direction });
          },
          sortAscendingLabel: (column) => tCommon("sortAscending", { column }),
          sortDescendingLabel: (column) => tCommon("sortDescending", { column }),
        }}
        pagination={{
          hasNext: Boolean(pagination?.next_cursor),
          hasPrevious: pager.hasPrevious,
          onNext: () => {
            if (!isFetching) pager.onNext(pagination);
          },
          onPrevious: () => {
            if (!isFetching) pager.onPrevious();
          },
          nextLabel: tCommon("next"),
          previousLabel: tCommon("previous"),
          pageSize: {
            value: pageSize,
            options: [25, 50, 100],
            onChange: setPageSize,
            label: tCommon("rowsPerPage"),
          },
          // /students is one of the two endpoints on CountedCursorPagination, so a
          // total is real here. There is no page NUMBER to show — a cursor pager does
          // not know where it is — so the count is the summary, not "page 2 of 12".
          summary:
            pagination?.total_count !== undefined
              ? tCommon("totalRows", { count: pagination.total_count })
              : null,
        }}
      />
    </div>
  );
}
