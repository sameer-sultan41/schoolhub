"use client";

import { fetchPage } from "@schoolhub/api-client";
import { isCursorPagination } from "@schoolhub/types";
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
} from "@schoolhub/ui";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Clock } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { ApiErrorAlert } from "@/components/api-error-alert";
import { Can } from "@/components/can";
import { FilterBar } from "@/components/filter-bar";
import { PeriodForm } from "@/features/timetable/period-form";
import { ALL, TIMETABLE_PAGE_SIZE } from "@/features/timetable/timetable-constants";
import { TimetableNav } from "@/features/timetable/timetable-nav";
import type { PeriodRecord } from "@/features/timetable/timetable-types";
import { useCampusOptions } from "@/features/timetable/use-timetable-reference-data";
import { useCursorPager } from "@/hooks/use-cursor-pager";
import { useTableParams } from "@/hooks/use-table-params";
import { apiClient } from "@/lib/auth";
import { queryKeys } from "@/lib/query-client";

/** The bell schedule (§5.1) — the rows every week grid is built on. */
export function PeriodsScreen() {
  const t = useTranslations("timetable");
  const tCommon = useTranslations("common");
  const pager = useCursorPager();

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

  const filters = table.query;
  pager.syncFilterKey(JSON.stringify(filters));

  const { data, isPending, isFetching, error } = useQuery({
    queryKey: queryKeys.list("timetable", "periods", { ...filters, cursor: pager.cursor }),
    queryFn: () =>
      fetchPage<PeriodRecord>(apiClient, "/periods", {
        query: {
          ...filters,
          ...(pager.cursor ? { cursor: pager.cursor } : {}),
        },
      }),
    placeholderData: keepPreviousData,
  });

  const campusNames = useMemo(
    () => new Map((campuses.data ?? []).map((campus) => [campus.id, campus.name])),
    [campuses.data],
  );

  const rows = data?.items ?? [];
  const pagination =
    data?.pagination && isCursorPagination(data.pagination) ? data.pagination : undefined;

  const columns: DataTableColumn<PeriodRecord>[] = [
    {
      id: "sequence",
      sortKey: "sequence",
      header: t("fields.sequence"),
      className: "tabular-nums",
      cell: (row) => row.sequence,
    },
    { id: "name", header: t("fields.name"), cell: (row) => row.name },
    {
      id: "time",
      sortKey: "start_time",
      header: t("periods.columns.time"),
      className: "tabular-nums",
      cell: (row) => `${row.start_time} – ${row.end_time}`,
    },
    {
      id: "campus",
      header: t("fields.campus"),
      // A null campus means "every campus" (the column's own help text), which is
      // information, not a missing value — so it gets words, not an em dash.
      cell: (row) =>
        row.campus_id
          ? (campusNames.get(row.campus_id) ?? t("fields.allCampuses"))
          : t("fields.allCampuses"),
    },
    {
      id: "weekdays",
      header: t("fields.weekdays"),
      cell: (row) =>
        row.weekdays && row.weekdays.length > 0
          ? row.weekdays.map((day) => t(`weekdaysShort.${day}`)).join(", ")
          : t("periods.everyWorkingDay"),
    },
    {
      id: "kind",
      header: t("periods.columns.kind"),
      cell: (row) =>
        row.is_break ? (
          <Badge variant="secondary">{t("periods.break")}</Badge>
        ) : (
          <Badge variant="outline">{t("periods.teaching")}</Badge>
        ),
    },
    {
      id: "actions",
      header: "",
      srLabel: t("periods.columns.actions"),
      className: "text-end",
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
