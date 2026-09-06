"use client";

import { fetchPage } from "@schoolhub/api-client";
import { Badge, DataTable, type DataTableColumn, EmptyState } from "@schoolhub/ui";
import { isCursorPagination } from "@schoolhub/types";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { TrendingUp } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { ApiErrorAlert } from "@/components/api-error-alert";
import { Can } from "@/components/can";
import { FilterBar } from "@/components/filter-bar";
import {
  ACADEMICS_PAGE_SIZE,
  ALL,
  PROMOTION_STATUSES,
  PROMOTION_STATUS_BADGE,
} from "@/features/academics/academics-constants";
import { AcademicsNav } from "@/features/academics/academics-nav";
import type { PromotionBatchRecord } from "@/features/academics/academics-types";
import { PromotionBatchForm } from "@/features/academics/promotion-batch-form";
import { useAcademicSessions, useClasses } from "@/features/students/use-reference-data";
import { useCursorPager } from "@/hooks/use-cursor-pager";
import { useTableParams } from "@/hooks/use-table-params";
import { apiClient } from "@/lib/auth";
import { queryKeys } from "@/lib/query-client";

const EMPTY = "—";

/**
 * Promotion decisions across batches, and the entry point for creating one.
 *
 * The API has no batch resource to list — `batch_id` is a logical grouping over
 * `student_promotions` rows — so this lists the rows and each one links to its
 * batch's review table. Filtering by session pair and class is what narrows it to
 * "the batch I mean", which is exactly the filter set §16 gives this endpoint.
 */
export function PromotionBatchesScreen() {
  const t = useTranslations("academics");
  const tCommon = useTranslations("common");
  const router = useRouter();
  const pager = useCursorPager();

  const sessions = useAcademicSessions();
  const classes = useClasses();

  const table = useTableParams({
    filterKeys: ["from_academic_session_id", "to_academic_session_id", "from_class_id", "status"],
    pageSize: ACADEMICS_PAGE_SIZE,
  });
  const fromSessionId = table.filter("from_academic_session_id");
  const toSessionId = table.filter("to_academic_session_id");
  const classId = table.filter("from_class_id");
  const status = table.filter("status");

  const filters = table.query;
  pager.syncFilterKey(JSON.stringify(filters));

  const { data, isPending, isFetching, error } = useQuery({
    queryKey: queryKeys.list("academics", "student-promotions", {
      ...filters,
      cursor: pager.cursor,
    }),
    queryFn: () =>
      // Batches, not decision rows: the server aggregates them, so the screen
      // no longer reconstructs a batch by grouping rows client-side.
      fetchPage<PromotionBatchRecord>(apiClient, "/student-promotions", {
        query: {
          ...filters,
          ...(pager.cursor ? { cursor: pager.cursor } : {}),
        },
      }),
    placeholderData: keepPreviousData,
  });

  const sessionNames = useMemo(
    () => new Map((sessions.data ?? []).map((session) => [session.id, session.name])),
    [sessions.data],
  );
  const classNames = useMemo(
    () => new Map((classes.data ?? []).map((option) => [option.id, option.name])),
    [classes.data],
  );

  const rows = data?.items ?? [];
  const pagination =
    data?.pagination && isCursorPagination(data.pagination) ? data.pagination : undefined;

  const columns: DataTableColumn<PromotionBatchRecord>[] = [
    {
      id: "batch",
      header: t("promotions.columns.batch"),
      numeric: "identifier",
      cell: (row) => row.batch_id,
    },
    {
      id: "class",
      header: t("promotions.columns.fromClass"),
      cell: (row) => classNames.get(row.from_class_id) ?? EMPTY,
    },
    {
      id: "sessions",
      header: t("promotions.columns.sessions"),
      cell: (row) =>
        t("promotions.sessionPair", {
          from: sessionNames.get(row.from_academic_session_id) ?? EMPTY,
          to: sessionNames.get(row.to_academic_session_id) ?? EMPTY,
        }),
    },
    {
      id: "students",
      header: t("promotions.columns.students"),
      numeric: "measure",
      cell: (row) => String(row.students),
    },
    {
      id: "status",
      header: t("promotions.columns.status"),
      cell: (row) => (
        <Badge variant={PROMOTION_STATUS_BADGE[row.status]}>
          {t(`promotions.status.${row.status}`)}
        </Badge>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <AcademicsNav />

      <div className="flex flex-wrap items-center justify-end gap-2">
        <Can permission="academics.promotion.create">
          <PromotionBatchForm />
        </Can>
      </div>

      <FilterBar
        selects={[
          {
            id: "fromSession",
            label: t("promotions.fields.fromSession"),
            value: fromSessionId,
            onChange: (value) => {
              table.setFilter("from_academic_session_id", value);
            },
            options: (sessions.data ?? []).map((session) => ({
              value: session.id,
              label: session.name,
            })),
            allLabel: t("filters.all"),
            allValue: ALL,
            className: "w-44",
          },
          {
            id: "toSession",
            label: t("promotions.fields.toSession"),
            value: toSessionId,
            onChange: (value) => {
              table.setFilter("to_academic_session_id", value);
            },
            options: (sessions.data ?? []).map((session) => ({
              value: session.id,
              label: session.name,
            })),
            allLabel: t("filters.all"),
            allValue: ALL,
            className: "w-44",
          },
          {
            id: "class",
            label: t("fields.class"),
            value: classId,
            onChange: (value) => {
              table.setFilter("from_class_id", value);
            },
            options: (classes.data ?? []).map((option) => ({
              value: option.id,
              label: option.name,
            })),
            allLabel: t("filters.all"),
            allValue: ALL,
          },
          {
            id: "status",
            label: t("promotions.columns.status"),
            value: status,
            onChange: (value) => {
              table.setFilter("status", value);
            },
            options: PROMOTION_STATUSES.map((value) => ({
              value,
              label: t(`promotions.status.${value}`),
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
        getRowId={(row) => row.batch_id}
        caption={t("promotions.list.caption")}
        isLoading={isPending}
        error={error ? <ApiErrorAlert error={error} /> : undefined}
        emptyState={
          <EmptyState
            icon={TrendingUp}
            title={t("promotions.list.emptyTitle")}
            description={t("promotions.list.emptyDescription")}
            action={
              <Can permission="academics.promotion.create">
                <PromotionBatchForm />
              </Can>
            }
          />
        }
        onRowClick={(row) => {
          router.push(`/academics/promotions/${row.batch_id}`);
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
            value: table.pageSize,
            options: [25, 50, 100],
            onChange: table.setPageSize,
            label: tCommon("rowsPerPage"),
          },
        }}
      />
    </div>
  );
}
