"use client";

import { fetchPage } from "@schoolhub/api-client";
import { isOffsetPagination } from "@schoolhub/types";
import {
  Badge,
  Button,
  DataTable,
  type DataTableColumn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  EmptyState,
  Skeleton,
} from "@schoolhub/ui";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Clock } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { ApiErrorAlert } from "@/components/api-error-alert";
import { Can } from "@/components/can";
import { FilterBar } from "@/components/filter-bar";
import { PeriodForm } from "@/features/timetable/period-form";
import { ALL, TIMETABLE_PAGE_SIZE } from "@/features/timetable/timetable-constants";
import { TimetableNav } from "@/features/timetable/timetable-nav";
import type { PeriodRecord } from "@/features/timetable/timetable-types";
import { useCampusOptions } from "@/features/timetable/use-timetable-reference-data";
import { useTableParams } from "@/hooks/use-table-params";
import { apiClient } from "@/lib/auth";
import { formatTime } from "@/lib/format";
import { queryKeys } from "@/lib/query-client";

/** A badge column's placeholder. A pill rather than the default text bar, so the row
 * keeps its shape when the real chip arrives. */
const BADGE_SKELETON = <Skeleton className="h-5 w-20 rounded-full" />;

/** The bell schedule (§5.1) — the rows every week grid is built on. */
export function PeriodsScreen() {
  const t = useTranslations("timetable");
  const tCommon = useTranslations("common");
  const locale = useLocale();

  const campuses = useCampusOptions();
  const table = useTableParams({
    filterKeys: ["campus_id"],
    pageSize: TIMETABLE_PAGE_SIZE,
    sortLabels: {
      ascending: (column) => tCommon("sortAscending", { column }),
      descending: (column) => tCommon("sortDescending", { column }),
    },
  });
  const campusId = table.filter("campus_id");

  // Carries `page` already, whenever the reader is past the first one, so the request
  // and the cache key both follow the pager without either of them restating it.
  const filters = table.query;

  const { data, isPending, error } = useQuery({
    queryKey: queryKeys.list("timetable", "periods", filters),
    queryFn: () => fetchPage<PeriodRecord>(apiClient, "/periods", { query: filters }),
    placeholderData: keepPreviousData,
  });

  const campusNames = useMemo(
    () => new Map((campuses.data ?? []).map((campus) => [campus.id, campus.name])),
    [campuses.data],
  );

  const rows = data?.items ?? [];
  // `/periods` pages by number, not by cursor (views.PeriodViewSet.pagination_class), so
  // the envelope carries `page`/`total_pages`. Narrowing to the other arm — which this
  // screen used to do — leaves `hasNext` permanently false and the list stuck on page one.
  const pagination =
    data?.pagination && isOffsetPagination(data.pagination) ? data.pagination : undefined;

  // The pager reads the URL, never the envelope: with `placeholderData` the envelope
  // still describes the page being replaced, so a number taken from it would lag a click
  // by a whole request. The range below comes from that same URL state so the two can
  // never disagree; only `total_count` has to come from the server.
  const pageSize = pagination?.page_size ?? table.pageSize;
  const totalCount = pagination?.total_count ?? 0;
  // Guarded rather than a bare `(page - 1) * size + 1`, which would read "1–0 of 0" on
  // an empty list.
  const firstRowOnPage = totalCount === 0 ? 0 : (table.page - 1) * pageSize + 1;
  const lastRowOnPage = Math.min(table.page * pageSize, totalCount);

  // Every sortKey below is an entry in PeriodViewSet.ordering_fields, which covers each
  // rendered column except `weekdays`: that one is a JSON array, and there is no ordering
  // of it a reader would recognise as the one the header promises.
  const columns: DataTableColumn<PeriodRecord>[] = [
    {
      id: "sequence",
      header: t("fields.sequence"),
      sortKey: "sequence",
      // A quantity read down the column and compared, so the table owns the treatment:
      // figures face, tabular digits, and ranged to the end.
      numeric: "measure",
      cell: (row) => row.sequence,
      // `ms-auto` because the loading row does not carry the column's alignment — the
      // placeholder has to sit where the figure will.
      skeleton: <Skeleton className="h-4 w-8" />,
    },
    {
      id: "name",
      header: t("fields.name"),
      sortKey: "name",
      cell: (row) => row.name,
      skeleton: <Skeleton className="h-4 w-32" />,
    },
    {
      id: "time",
      header: t("periods.columns.time"),
      sortKey: "start_time",
      // Digits that name the row rather than measure it, so they align but stay
      // start-ranged — a reader matches a bell time from its first character.
      numeric: "identifier",
      // DRF serialises a TimeField with seconds a bell schedule never has, and rendering
      // them puts four characters of noise on both ends of every row.
      cell: (row) => `${formatTime(row.start_time, locale)} – ${formatTime(row.end_time, locale)}`,
      skeleton: <Skeleton className="h-4 w-24" />,
    },
    {
      id: "campus",
      header: t("fields.campus"),
      sortKey: "campus_name",
      // A null campus means "every campus" (the column's own help text), which is
      // information, not a missing value — so it gets words, not an em dash.
      cell: (row) =>
        row.campus_id
          ? (campusNames.get(row.campus_id) ?? t("fields.allCampuses"))
          : t("fields.allCampuses"),
      skeleton: <Skeleton className="h-4 w-28" />,
    },
    {
      id: "weekdays",
      header: t("fields.weekdays"),
      // One chip per day rather than "Mon, Fri": the days are a set, and a comma-joined
      // string reads as a sentence the eye has to parse instead of a shape it can count.
      // No sortKey — see the comment above the array.
      cell: (row) =>
        row.weekdays && row.weekdays.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {row.weekdays.map((day) => (
              <Badge key={day} variant="outline" appearance="soft">
                {t(`weekdaysShort.${day}`)}
              </Badge>
            ))}
          </div>
        ) : (
          t("periods.everyWorkingDay")
        ),
      skeleton: (
        <div className="flex gap-1">
          <Skeleton className="h-5 w-10 rounded-full" />
          <Skeleton className="h-5 w-10 rounded-full" />
          <Skeleton className="h-5 w-10 rounded-full" />
        </div>
      ),
    },
    {
      id: "kind",
      header: t("periods.columns.kind"),
      sortKey: "is_break",
      cell: (row) =>
        row.is_break ? (
          <Badge variant="secondary" appearance="soft">
            {t("periods.break")}
          </Badge>
        ) : (
          <Badge variant="outline" appearance="soft">
            {t("periods.teaching")}
          </Badge>
        ),
      skeleton: BADGE_SKELETON,
    },
    {
      id: "actions",
      header: "",
      srLabel: t("periods.columns.actions"),
      className: "text-end",
      // Never offered in the columns menu: hiding it leaves rows a reader can look at
      // and not act on, with the menu that hid it as the only way back.
      alwaysVisible: true,
      cell: (row) => (
        <div className="flex justify-end gap-2">
          <Can permission="timetable.period.update">
            <PeriodForm period={row} />
          </Can>
          <Can permission="timetable.period.delete">
            <DeletePeriodDialog period={row} />
          </Can>
        </div>
      ),
      skeleton: (
        <div className="flex justify-end gap-2">
          <Skeleton className="h-8 w-16" />
          <Skeleton className="h-8 w-20" />
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <TimetableNav />

      <div className="flex flex-wrap items-center justify-end gap-2">
        <Can permission="timetable.period.create">
          <PeriodForm />
        </Can>
      </div>

      <FilterBar
        selects={[
          {
            id: "campus",
            label: t("fields.campus"),
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
            className: "w-48",
          },
        ]}
        clearLabel={tCommon("clearFilters")}
        onClear={table.clear}
      />

      <DataTable
        columns={columns}
        rows={rows}
        getRowId={(row) => row.id}
        caption={t("periods.list.caption")}
        isLoading={isPending}
        error={error ? <ApiErrorAlert error={error} /> : undefined}
        emptyState={
          <EmptyState
            icon={Clock}
            title={t("periods.list.emptyTitle")}
            description={t("periods.list.emptyDescription")}
            action={
              <Can permission="timetable.period.create">
                <PeriodForm />
              </Can>
            }
          />
        }
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
          // "1–25 of 84" rather than the nothing this showed under cursor paging: with a
          // page number on screen, where the reader is in the list is finally a fact the
          // summary can state.
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

/**
 * `timetable_slots.period` is `on_delete=PROTECT`, so a period already used by a
 * slot cannot be removed — the API answers 409 and the envelope says so. The
 * dialog therefore warns rather than promising.
 */
function DeletePeriodDialog({ period }: { period: PeriodRecord }) {
  const t = useTranslations("timetable");
  const tCommon = useTranslations("common");
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const mutation = useMutation({
    mutationFn: () => apiClient.delete(`/periods/${period.id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.module("timetable") });
      setOpen(false);
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="danger" size="sm">
          {t("periods.actions.delete")}
        </Button>
      </DialogTrigger>
      <DialogContent closeLabel={t("common.close")}>
        <DialogHeader>
          <DialogTitle>{t("periods.delete.title")}</DialogTitle>
          <DialogDescription>{t("periods.delete.description")}</DialogDescription>
        </DialogHeader>

        <ApiErrorAlert error={mutation.error} />

        <DialogFooter>
          <Button
            variant="danger"
            isLoading={mutation.isPending}
            loadingLabel={tCommon("loading")}
            onClick={() => {
              mutation.mutate();
            }}
          >
            {t("periods.actions.delete")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
