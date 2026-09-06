"use client";

import { collectPages, fetchPage } from "@schoolhub/api-client";
import {
  Badge,
  BadgeDot,
  Button,
  DataTable,
  type DataTableColumn,
  EmptyState,
  Skeleton,
} from "@schoolhub/ui";
import { isOffsetPagination } from "@schoolhub/types";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Users } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { ApiErrorAlert } from "@/components/api-error-alert";
import { Can } from "@/components/can";
import { FilterBar } from "@/components/filter-bar";
import { PersonCell } from "@/components/person-cell";
import { STAFF_PAGE_SIZE } from "@/features/staff/staff-constants";
import type { EmploymentStatus, StaffRecord, StaffType } from "@/features/staff/staff-types";
import { useDesignations } from "@/features/staff/use-designations";
import { useCampuses } from "@/features/students/use-reference-data";
import { useTableParams } from "@/hooks/use-table-params";
import { apiClient } from "@/lib/auth";
import { queryKeys } from "@/lib/query-client";

const STAFF_TYPES: StaffType[] = ["teaching", "non_teaching"];

const EMPLOYMENT_STATUSES: EmploymentStatus[] = [
  "active",
  "on_leave",
  "suspended",
  "resigned",
  "retired",
  "terminated",
];

/** No email on file. Mirrors staff-detail.tsx's EMPTY exactly. */
const EMPTY = "—";

/**
 * The badge variant a staff member's employment status wears.
 *
 * A function rather than the `Record` this used to be so it can be imported and asserted
 * on its own — the mapping is a product decision, and a test that pins it should not
 * have to render a whole table to reach it. Mirrors `getStudentStatusVariant`.
 *
 * A `switch` rather than a lookup object because the annotated return type then makes
 * exhaustiveness a compile error: a seventh `EmploymentStatus` fails the build here
 * instead of rendering an undefined variant.
 */
export function getStaffStatusVariant(
  status: EmploymentStatus,
): "secondary" | "success" | "warning" | "danger" {
  switch (status) {
    case "active":
      return "success";
    // Both are temporary and both are someone's problem today — a class needs covering,
    // a case is open.
    case "on_leave":
    case "suspended":
      return "warning";
    case "terminated":
      return "danger";
    // Ordinary ends of an employment, not failures.
    case "resigned":
    case "retired":
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

interface DepartmentOption {
  id: string;
  name: string;
}

/** Sentinel for "no filter" in a Select — kept out of the request params
 * entirely rather than sent as an empty string, so `{}` and `{status: ""}` are
 * the same cache key. Mirrors students-table.tsx's ALL_STATUSES exactly. */
const ALL = "__all__";

export function StaffTable() {
  const t = useTranslations("staff");
  const tCommon = useTranslations("common");
  const router = useRouter();

  const campuses = useCampuses();
  const designations = useDesignations();
  const departmentsQuery = useQuery({
    queryKey: queryKeys.list("staff", "departments"),
    queryFn: () => collectPages<DepartmentOption>(apiClient, "/departments"),
  });

  const table = useTableParams({
    filterKeys: ["staff_type", "employment_status", "campus_id", "department_id", "designation_id"],
    searchable: true,
    pageSize: STAFF_PAGE_SIZE,
    sortLabels: {
      ascending: (column) => tCommon("sortAscending", { column }),
      descending: (column) => tCommon("sortDescending", { column }),
    },
  });
  const staffType = table.filter("staff_type");
  const employmentStatus = table.filter("employment_status");
  const campusId = table.filter("campus_id");
  const departmentId = table.filter("department_id");
  const designationId = table.filter("designation_id");
  const search = table.search;

  // Carries `page` already, whenever the reader is past the first one, so the request
  // and the cache key both follow the pager without either of them restating it.
  const filters = table.query;

  const { data, isPending, error } = useQuery({
    queryKey: queryKeys.list("staff", "staff", filters),
    queryFn: () => fetchPage<StaffRecord>(apiClient, "/staff", { query: filters }),
    placeholderData: keepPreviousData,
  });

  const rows = data?.items ?? [];
  // /staff pages by number now, not by cursor — see students-table.tsx's identical
  // narrowing comment for why the union still has to be narrowed here.
  const pagination =
    data?.pagination && isOffsetPagination(data.pagination) ? data.pagination : undefined;

  // The pager reads the URL, never the envelope: with `placeholderData` the envelope
  // still describes the page being replaced, so a number taken from it would lag a click
  // by a whole request. The range below comes from that same URL state so the two can
  // never disagree; only `total_count` has to come from the server.
  const pageSize = pagination?.page_size ?? table.pageSize;
  const totalCount = pagination?.total_count ?? 0;
  // Guarded rather than a bare `(page - 1) * size + 1`, which would read "1–0 of 0" on
  // an empty roll.
  const firstRowOnPage = totalCount === 0 ? 0 : (table.page - 1) * pageSize + 1;
  const lastRowOnPage = Math.min(table.page * pageSize, totalCount);

  const columns: DataTableColumn<StaffRecord>[] = [
    {
      id: "name",
      sortKey: "last_name",
      header: t("columns.name"),
      // The employee number rides under the name now instead of holding a column of its
      // own: a reader reads the two together anyway, and folding them buys back a whole
      // column's width for the rest of the table.
      cell: (row) => (
        <PersonCell name={`${row.first_name} ${row.last_name}`} secondary={row.employee_number} />
      ),
      skeleton: PERSON_SKELETON,
    },
    {
      id: "staffType",
      header: t("columns.staffType"),
      sortKey: "staff_type",
      // `outline` soft — the neutral chip. Teaching and non-teaching are a
      // classification, not a state of health, so neither takes a hue: a green or amber
      // pill here would read as a status beside the one that actually is one.
      cell: (row) => (
        <Badge variant="outline" appearance="soft">
          {t(`staffType.${row.staff_type}`)}
        </Badge>
      ),
      skeleton: <Skeleton className="h-5 w-24 rounded-full" />,
    },
    {
      id: "employmentStatus",
      header: t("columns.employmentStatus"),
      sortKey: "employment_status",
      // Soft rather than solid: one saturated pill per row, down every row of the page,
      // reads as a wall of colour. The dot keeps the chip legible as a STATUS at a
      // glance now that its fill is only a tint.
      cell: (row) => (
        <Badge variant={getStaffStatusVariant(row.employment_status)} appearance="soft">
          <BadgeDot />
          {t(`employmentStatus.${row.employment_status}`)}
        </Badge>
      ),
      skeleton: <Skeleton className="h-5 w-20 rounded-full" />,
    },
    {
      id: "email",
      header: t("columns.email"),
      sortKey: "email",
      // Capped and truncated with the full address in `title`: a school address can run
      // past forty characters, and letting one push every other column sideways costs
      // more than the tail of it is worth. Nullable server-side — staff with no address
      // get the dash rather than an empty cell that reads as a rendering fault.
      cell: (row) =>
        row.email ? (
          <span className="block max-w-[24ch] truncate" title={row.email}>
            {row.email}
          </span>
        ) : (
          EMPTY
        ),
      skeleton: <Skeleton className="h-4 w-32" />,
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Can permission="staff.staff.import">
          <Button asChild variant="outline" size="sm">
            <Link href="/staff/import">{t("actions.import")}</Link>
          </Button>
        </Can>
        <Can permission="staff.staff.create">
          <Button asChild size="sm">
            <Link href="/staff/new">{t("actions.create")}</Link>
          </Button>
        </Can>
      </div>

      <FilterBar
        search={{
          label: t("filters.search"),
          placeholder: t("list.searchPlaceholder"),
          value: search,
          onChange: table.setSearch,
        }}
        selects={[
          {
            id: "staffType",
            label: t("filters.staffType"),
            value: staffType,
            onChange: (value) => {
              table.setFilter("staff_type", value);
            },
            options: STAFF_TYPES.map((value) => ({ value, label: t(`staffType.${value}`) })),
            allLabel: t("filters.all"),
            allValue: ALL,
          },
          {
            id: "employmentStatus",
            label: t("filters.employmentStatus"),
            value: employmentStatus,
            onChange: (value) => {
              table.setFilter("employment_status", value);
            },
            options: EMPLOYMENT_STATUSES.map((value) => ({
              value,
              label: t(`employmentStatus.${value}`),
            })),
            allLabel: t("filters.all"),
            allValue: ALL,
          },
          {
            id: "campus",
            label: t("filters.campus"),
            value: campusId,
            onChange: (value) => {
              table.setFilter("campus_id", value);
            },
            options: (campuses.data ?? []).map((campus) => ({
              value: campus.id,
              label: campus.name,
            })),
            allLabel: t("filters.all"),
            allValue: ALL,
          },
          {
            id: "department",
            label: t("filters.department"),
            value: departmentId,
            onChange: (value) => {
              table.setFilter("department_id", value);
            },
            options: (departmentsQuery.data ?? []).map((department) => ({
              value: department.id,
              label: department.name,
            })),
            allLabel: t("filters.all"),
            allValue: ALL,
          },
          {
            id: "designation",
            label: t("filters.designation"),
            value: designationId,
            onChange: (value) => {
              table.setFilter("designation_id", value);
            },
            options: (designations.data ?? []).map((designation) => ({
              value: designation.id,
              label: designation.name,
            })),
            allLabel: t("filters.all"),
            allValue: ALL,
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
        error={error ? <ApiErrorAlert error={error} /> : undefined}
        emptyState={
          <EmptyState
            icon={Users}
            title={t("list.emptyTitle")}
            description={t("list.emptyDescription")}
            action={
              <Can permission="staff.staff.create">
                <Button asChild size="sm">
                  <Link href="/staff/new">{t("actions.create")}</Link>
                </Button>
              </Can>
            }
          />
        }
        onRowClick={(row) => {
          router.push(`/staff/${row.id}`);
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
          // "1–25 of 84" rather than the bare total this showed under cursor paging:
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
