"use client";

import { ApiError, collectPages, fetchPage } from "@schoolhub/api-client";
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  DataTable,
  type DataTableColumn,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@schoolhub/ui";
import { isCursorPagination } from "@schoolhub/types";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { Can } from "@/components/can";
import { SEARCH_DEBOUNCE_MS, STAFF_PAGE_SIZE } from "@/features/staff/staff-constants";
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
  const tErrors = useTranslations("errors");
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
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  // Simple debounce: schedule the commit, clear it on every keystroke. Mirrors
  // students-table.tsx's identical pattern.
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function onSearchChange(value: string) {
    setSearch(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setDebouncedSearch(value);
    }, SEARCH_DEBOUNCE_MS);
  }

  const filters = useMemo(
    () => ({
      ...(staffType !== ALL ? { staff_type: staffType } : {}),
      ...(employmentStatus !== ALL ? { employment_status: employmentStatus } : {}),
      ...(campusId !== ALL ? { campus_id: campusId } : {}),
      ...(departmentId !== ALL ? { department_id: departmentId } : {}),
      ...(designationId !== ALL ? { designation_id: designationId } : {}),
      ...(debouncedSearch ? { search: debouncedSearch } : {}),
    }),
    [staffType, employmentStatus, campusId, departmentId, designationId, debouncedSearch],
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

  if (error instanceof ApiError) {
    return (
      <Alert variant="danger">
        <AlertDescription>
          {tErrors.has(error.code) ? tErrors(error.code) : error.message}
          {error.requestId ? ` ${tErrors("requestId", { requestId: error.requestId })}` : ""}
        </AlertDescription>
      </Alert>
    );
  }

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

      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-48 flex-1 space-y-1">
          <label htmlFor="staff-search" className="text-xs font-medium text-muted-foreground">
            {t("filters.search")}
          </label>
          <Input
            id="staff-search"
            value={search}
            onChange={(event) => {
              onSearchChange(event.target.value);
            }}
            placeholder={t("list.searchPlaceholder")}
          />
        </div>
        <div className="w-40 space-y-1">
          <span className="text-xs font-medium text-muted-foreground">
            {t("filters.staffType")}
          </span>
          <Select
            value={staffType}
            onValueChange={(value) => {
              setStaffType(value as typeof staffType);
            }}
          >
            <SelectTrigger aria-label={t("filters.staffType")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t("filters.all")}</SelectItem>
              {STAFF_TYPES.map((value) => (
                <SelectItem key={value} value={value}>
                  {t(`staffType.${value}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="w-40 space-y-1">
          <span className="text-xs font-medium text-muted-foreground">
            {t("filters.employmentStatus")}
          </span>
          <Select
            value={employmentStatus}
            onValueChange={(value) => {
              setEmploymentStatus(value as typeof employmentStatus);
            }}
          >
            <SelectTrigger aria-label={t("filters.employmentStatus")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t("filters.all")}</SelectItem>
              {EMPLOYMENT_STATUSES.map((value) => (
                <SelectItem key={value} value={value}>
                  {t(`employmentStatus.${value}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="w-40 space-y-1">
          <span className="text-xs font-medium text-muted-foreground">{t("filters.campus")}</span>
          <Select
            value={campusId}
            onValueChange={(value) => {
              setCampusId(value);
            }}
          >
            <SelectTrigger aria-label={t("filters.campus")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t("filters.all")}</SelectItem>
              {(campuses.data ?? []).map((campus) => (
                <SelectItem key={campus.id} value={campus.id}>
                  {campus.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="w-40 space-y-1">
          <span className="text-xs font-medium text-muted-foreground">
            {t("filters.department")}
          </span>
          <Select
            value={departmentId}
            onValueChange={(value) => {
              setDepartmentId(value);
            }}
          >
            <SelectTrigger aria-label={t("filters.department")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t("filters.all")}</SelectItem>
              {(departmentsQuery.data ?? []).map((department) => (
                <SelectItem key={department.id} value={department.id}>
                  {department.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="w-40 space-y-1">
          <span className="text-xs font-medium text-muted-foreground">
            {t("filters.designation")}
          </span>
          <Select
            value={designationId}
            onValueChange={(value) => {
              setDesignationId(value);
            }}
          >
            <SelectTrigger aria-label={t("filters.designation")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t("filters.all")}</SelectItem>
              {(designations.data ?? []).map((designation) => (
                <SelectItem key={designation.id} value={designation.id}>
                  {designation.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <DataTable
        columns={columns}
        rows={rows}
        getRowId={(row) => row.id}
        caption={t("list.caption")}
        isLoading={isPending}
        emptyState={t("list.empty")}
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
