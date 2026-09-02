"use client";

import { ApiError, fetchPage } from "@schoolhub/api-client";
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
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { Can } from "@/components/can";
import { SEARCH_DEBOUNCE_MS, STUDENTS_PAGE_SIZE } from "@/features/students/student-constants";
import { useCursorPager } from "@/features/students/use-cursor-pager";
import type { StudentRecord, StudentStatus } from "@/features/students/student-types";
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
  const tErrors = useTranslations("errors");
  const router = useRouter();
  const pager = useCursorPager();

  const [status, setStatus] = useState<StudentStatus | typeof ALL_STATUSES>(ALL_STATUSES);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  // Simple debounce: schedule the commit, clear it on every keystroke. The raw
  // `search` value stays bound to the input so typing never lags; only
  // `debouncedSearch` — the one that lands in the query key — is delayed.
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
      ...(status !== ALL_STATUSES ? { status } : {}),
      ...(debouncedSearch ? { search: debouncedSearch } : {}),
    }),
    [status, debouncedSearch],
  );
  pager.syncFilterKey(JSON.stringify(filters));

  const { data, isPending, isFetching, error } = useQuery({
    queryKey: queryKeys.list("students", "students", { ...filters, cursor: pager.cursor }),
    queryFn: () =>
      fetchPage<StudentRecord>(apiClient, "/students", {
        query: {
          ...filters,
          ...(pager.cursor ? { cursor: pager.cursor } : {}),
          page_size: STUDENTS_PAGE_SIZE,
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
  const pagination = data?.pagination;

  const columns: DataTableColumn<StudentRecord>[] = [
    {
      id: "admissionNumber",
      header: t("columns.admissionNumber"),
      className: "tabular-nums",
      cell: (row) => row.admission_number,
    },
    {
      id: "name",
      header: t("columns.name"),
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
      <div className="flex justify-end">
        <Can permission="students.student.create">
          <Button asChild size="sm">
            <Link href="/students/new">{t("actions.create")}</Link>
          </Button>
        </Can>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-48 flex-1 space-y-1">
          <label htmlFor="students-search" className="text-xs font-medium text-muted-foreground">
            {t("filters.search")}
          </label>
          <Input
            id="students-search"
            value={search}
            onChange={(event) => {
              onSearchChange(event.target.value);
            }}
            placeholder={t("list.searchPlaceholder")}
          />
        </div>
        <div className="w-40 space-y-1">
          <span className="text-xs font-medium text-muted-foreground">{t("filters.status")}</span>
          <Select
            value={status}
            onValueChange={(value) => {
              setStatus(value as typeof status);
            }}
          >
            <SelectTrigger aria-label={t("filters.status")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_STATUSES}>{t("filters.all")}</SelectItem>
              {STATUSES.map((value) => (
                <SelectItem key={value} value={value}>
                  {t(`status.${value}`)}
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
          router.push(`/students/${row.id}`);
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
