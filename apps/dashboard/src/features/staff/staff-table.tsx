"use client";

import { collectPages, fetchPage } from "@schoolhub/api-client";
import { Badge, Button, DataTable, type DataTableColumn, EmptyState } from "@schoolhub/ui";
import { isCursorPagination } from "@schoolhub/types";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Users } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ApiErrorAlert } from "@/components/api-error-alert";
import { Can } from "@/components/can";
import { FilterBar } from "@/components/filter-bar";
import { STAFF_PAGE_SIZE } from "@/features/staff/staff-constants";
import type { EmploymentStatus, StaffRecord, StaffType } from "@/features/staff/staff-types";
import { useDesignations } from "@/features/staff/use-designations";
import { useCampuses } from "@/features/students/use-reference-data";
import { useCursorPager } from "@/hooks/use-cursor-pager";
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

const STATUS_BADGE_VARIANT: Record<
  EmploymentStatus,
  "secondary" | "success" | "warning" | "danger"
> = {
  active: "success",
  on_leave: "warning",
  suspended: "warning",
  resigned: "secondary",
  retired: "secondary",
  terminated: "danger",
};

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
  const pager = useCursorPager();

  const campuses = useCampuses();
  const designations = useDesignations();
  const departmentsQuery = useQuery({
    queryKey: queryKeys.list("staff", "departments"),
    queryFn: () => collectPages<DepartmentOption>(apiClient, "/departments"),
  });

  const [staffType, setStaffType] = useState<StaffType | typeof ALL>(ALL);
  const [employmentStatus, setEmploymentStatus] = useState<EmploymentStatus | typeof ALL>(ALL);
  const [campusId, setCampusId] = useState<string>(ALL);
  const [departmentId, setDepartmentId] = useState<string>(ALL);
  const [designationId, setDesignationId] = useState<string>(ALL);
  // The COMMITTED search term only — FilterBar owns the draft and the debounce.
  const [search, setSearch] = useState("");

  const filters = useMemo(
    () => ({
      ...(staffType !== ALL ? { staff_type: staffType } : {}),
      ...(employmentStatus !== ALL ? { employment_status: employmentStatus } : {}),
      ...(campusId !== ALL ? { campus_id: campusId } : {}),
      ...(departmentId !== ALL ? { department_id: departmentId } : {}),
      ...(designationId !== ALL ? { designation_id: designationId } : {}),
      ...(search ? { search } : {}),
    }),
    [staffType, employmentStatus, campusId, departmentId, designationId, search],
  );
  pager.syncFilterKey(JSON.stringify(filters));

  const { data, isPending, isFetching, error } = useQuery({
    queryKey: queryKeys.list("staff", "staff", { ...filters, cursor: pager.cursor }),
    queryFn: () =>
      fetchPage<StaffRecord>(apiClient, "/staff", {
        query: {
          ...filters,
          ...(pager.cursor ? { cursor: pager.cursor } : {}),
          page_size: STAFF_PAGE_SIZE,
        },
      }),
    placeholderData: keepPreviousData,
  });

  const rows = data?.items ?? [];
  // /staff paginates by cursor, never offset — see students-table.tsx's
  // identical narrowing comment for why.
  const pagination =
    data?.pagination && isCursorPagination(data.pagination) ? data.pagination : undefined;

  const columns: DataTableColumn<StaffRecord>[] = [
    {
      id: "employeeNumber",
      header: t("columns.employeeNumber"),
      className: "tabular-nums",
      cell: (row) => row.employee_number,
    },
    {
      id: "name",
      header: t("columns.name"),
      cell: (row) => `${row.first_name} ${row.last_name}`,
    },
    {
      id: "staffType",
      header: t("columns.staffType"),
      cell: (row) => t(`staffType.${row.staff_type}`),
    },
    {
      id: "employmentStatus",
      header: t("columns.employmentStatus"),
      cell: (row) => (
        <Badge variant={STATUS_BADGE_VARIANT[row.employment_status]}>
          {t(`employmentStatus.${row.employment_status}`)}
        </Badge>
      ),
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
          onChange: setSearch,
        }}
        selects={[
          {
            id: "staffType",
            label: t("filters.staffType"),
            value: staffType,
            onChange: (value) => {
              setStaffType(value as typeof staffType);
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
              setEmploymentStatus(value as typeof employmentStatus);
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
            onChange: setCampusId,
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
            onChange: setDepartmentId,
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
            onChange: setDesignationId,
            options: (designations.data ?? []).map((designation) => ({
              value: designation.id,
              label: designation.name,
            })),
            allLabel: t("filters.all"),
            allValue: ALL,
          },
        ]}
        clearLabel={tCommon("clearFilters")}
        onClear={() => {
          setSearch("");
          setStaffType(ALL);
          setEmploymentStatus(ALL);
          setCampusId(ALL);
          setDepartmentId(ALL);
          setDesignationId(ALL);
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
        }}
      />
    </div>
  );
}
