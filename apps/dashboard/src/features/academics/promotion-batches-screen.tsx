"use client";

import { fetchPage } from "@schoolhub/api-client";
import {
  Badge,
  BadgeDot,
  DataTable,
  type DataTableColumn,
  EmptyState,
  Skeleton,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@schoolhub/ui";
import { isOffsetPagination } from "@schoolhub/types";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { TrendingUp } from "lucide-react";
import { useLocale, useNow, useTranslations } from "next-intl";
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
import { useTableParams } from "@/hooks/use-table-params";
import { apiClient } from "@/lib/auth";
import { formatCount, formatDateTime, formatRelativeTime } from "@/lib/format";
import { queryKeys } from "@/lib/query-client";

/** Enough of a v4 UUID to tell two batches apart in a list; the full id is on the
 * cell's `title`, and the row itself is the way through to the batch. */
const BATCH_ID_PREFIX_LENGTH = 8;

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
  const locale = useLocale();
  // next-intl's clock, not `new Date()`. `formatRelativeTime` defaults to the machine
  // clock, and nothing can pin that: the provider's `now` never reaches the cell, so a
  // test could only assert a distance from whenever it happened to run.
  const now = useNow();
  const router = useRouter();

  const sessions = useAcademicSessions();
  const classes = useClasses();

  const table = useTableParams({
    filterKeys: ["from_academic_session_id", "to_academic_session_id", "from_class_id", "status"],
    pageSize: ACADEMICS_PAGE_SIZE,
    // `/student-promotions` declares an `ordering_fields` allowlist now — `status`,
    // `students` and `started_at`, the three columns this table is read by — so the
    // headers can sort. Nothing else is on offer: every other field would join the
    // GROUP BY and quietly un-group the aggregate.
    sortLabels: {
      ascending: (column) => tCommon("sortAscending", { column }),
      descending: (column) => tCommon("sortDescending", { column }),
    },
  });
  const fromSessionId = table.filter("from_academic_session_id");
  const toSessionId = table.filter("to_academic_session_id");
  const classId = table.filter("from_class_id");
  const status = table.filter("status");

  // `query` already carries `page` and `page_size` alongside the filters, so the
  // request is the hook's output spread straight in — there is no cursor to thread
  // through any more.
  const filters = table.query;

  const { data, isPending, error } = useQuery({
    queryKey: queryKeys.list("academics", "student-promotions", filters),
    queryFn: () =>
      // Batches, not decision rows: the server aggregates them, so the screen
      // no longer reconstructs a batch by grouping rows client-side.
      fetchPage<PromotionBatchRecord>(apiClient, "/student-promotions", { query: filters }),
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
  // /student-promotions pages by NUMBER now, never by cursor.
  const pagination =
    data?.pagination && isOffsetPagination(data.pagination) ? data.pagination : undefined;

  // The reader's own page, not the one the server echoed. `keepPreviousData` holds the
  // previous page's rows — and therefore its meta — in place while the next one loads,
  // so reading the number back off the response would leave the pager sitting on the
  // page just left for a whole round trip after the press.
  const firstRowOnPage = (table.page - 1) * table.pageSize + 1;
  const lastRowOnPage = Math.min(table.page * table.pageSize, pagination?.total_count ?? 0);

  const columns: DataTableColumn<PromotionBatchRecord>[] = [
    {
      id: "batch",
      header: t("promotions.columns.batch"),
      // Not sortable: `batch_id` is grouped on, not ordered by — `ordering_fields`
      // exposes only status, students and started_at.
      numeric: "identifier",
      // A full v4 UUID is 36 characters of noise in a column nobody reads end to end;
      // the first eight separate any two batches a school has open. `title` keeps the
      // whole id one hover away, for pasting into a support thread.
      cell: (row) => (
        <span title={row.batch_id}>{row.batch_id.slice(0, BATCH_ID_PREFIX_LENGTH)}</span>
      ),
      skeleton: <Skeleton className="h-4 w-16" />,
    },
    {
      id: "class",
      header: t("promotions.columns.fromClass"),
      cell: (row) => classNames.get(row.from_class_id) ?? EMPTY,
      skeleton: <Skeleton className="h-4 w-20" />,
    },
    {
      id: "sessions",
      header: t("promotions.columns.sessions"),
      cell: (row) =>
        t("promotions.sessionPair", {
          from: sessionNames.get(row.from_academic_session_id) ?? EMPTY,
          to: sessionNames.get(row.to_academic_session_id) ?? EMPTY,
        }),
      skeleton: <Skeleton className="h-4 w-36" />,
    },
    {
      id: "students",
      header: t("promotions.columns.students"),
      sortKey: "students",
      numeric: "measure",
      cell: (row) => formatCount(row.students, locale),
      // `ms-auto` because the skeleton row is rendered without the column's numeric
      // classes, so the bar would otherwise sit at the start of a column that ranges end.
      skeleton: <Skeleton className="h-4 w-8" />,
    },
    {
      id: "startedAt",
      header: t("promotions.columns.startedAt"),
      sortKey: "started_at",
      // Deliberately not `numeric`: the cell reads "2 months ago", which is a phrase
      // with a digit in it, not a figure. The numeric face would set the whole string
      // in tabular numerals for the sake of one character.
      //
      // "2 months ago" is what a reader wants from a rollover batch at a glance; the
      // exact moment is the thing they need once, so it rides in the tooltip.
      //
      // The trigger is a focusable span rather than the button Radix renders by
      // default: the row navigates to the batch, and DataTable declines to fire
      // `onRowClick` for a click that started inside a <button>, so a button here would
      // make this one cell the dead spot in an otherwise clickable row. `tabIndex` is
      // what keeps the absolute date reachable without a pointer.
      cell: (row) => (
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              tabIndex={0}
              className="rounded-[var(--sh-radius)] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              {formatRelativeTime(row.started_at, locale, now)}
            </span>
          </TooltipTrigger>
          <TooltipContent>{formatDateTime(row.started_at, locale)}</TooltipContent>
        </Tooltip>
      ),
      skeleton: <Skeleton className="h-4 w-24" />,
    },
    {
      id: "status",
      header: t("promotions.columns.status"),
      sortKey: "status",
      // Soft, with a dot: one solid pill per row down a whole column reads as a wall of
      // colour, and the dot keeps five statuses separable without leaning on hue alone.
      cell: (row) => (
        <Badge variant={PROMOTION_STATUS_BADGE[row.status]} appearance="soft">
          <BadgeDot />
          {t(`promotions.status.${row.status}`)}
        </Badge>
      ),
      skeleton: <Skeleton className="h-5 w-24 rounded-full" />,
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

      <DataTable
        toolbar={
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
        }
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
        sort={table.sort}
        columnVisibility={{
          hidden: table.hiddenColumns,
          onChange: table.setHiddenColumns,
          triggerLabel: tCommon("columns"),
          title: tCommon("toggleColumns"),
        }}
        pagination={{
          mode: "pages",
          page: table.page,
          // 0 while the first page is in flight, which renders no pager at all rather
          // than a one-page one that grows the moment the count arrives.
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
