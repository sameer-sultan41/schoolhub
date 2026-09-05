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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@schoolhub/ui";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { Can } from "@/components/can";
import { PeriodForm } from "@/features/timetable/period-form";
import { ALL, TIMETABLE_PAGE_SIZE } from "@/features/timetable/timetable-constants";
import { ApiErrorAlert } from "@/features/timetable/timetable-error-alert";
import { TimetableNav } from "@/features/timetable/timetable-nav";
import type { PeriodRecord } from "@/features/timetable/timetable-types";
import { useCampusOptions } from "@/features/timetable/use-timetable-reference-data";
import { useCursorPager } from "@/hooks/use-cursor-pager";
import { apiClient } from "@/lib/auth";
import { queryKeys } from "@/lib/query-client";

/** The bell schedule (§5.1) — the rows every week grid is built on. */
export function PeriodsScreen() {
  const t = useTranslations("timetable");
  const tCommon = useTranslations("common");
  const pager = useCursorPager();

  const campuses = useCampusOptions();
  const [campusId, setCampusId] = useState<string>(ALL);

  const filters = useMemo(() => (campusId !== ALL ? { campus_id: campusId } : {}), [campusId]);
  pager.syncFilterKey(JSON.stringify(filters));

  const { data, isPending, isFetching, error } = useQuery({
    queryKey: queryKeys.list("timetable", "periods", { ...filters, cursor: pager.cursor }),
    queryFn: () =>
      fetchPage<PeriodRecord>(apiClient, "/periods", {
        query: {
          ...filters,
          ...(pager.cursor ? { cursor: pager.cursor } : {}),
          page_size: TIMETABLE_PAGE_SIZE,
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
      header: t("fields.sequence"),
      className: "tabular-nums",
      cell: (row) => row.sequence,
    },
    { id: "name", header: t("fields.name"), cell: (row) => row.name },
    {
      id: "time",
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

      <div className="flex flex-wrap items-end gap-3">
        <div className="w-48 space-y-1">
          <span className="text-xs font-medium text-muted-foreground">{t("fields.campus")}</span>
          <Select value={campusId} onValueChange={setCampusId}>
            <SelectTrigger aria-label={t("fields.campus")}>
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
      </div>

      {error ? (
        <ApiErrorAlert error={error} />
      ) : (
        <DataTable
          columns={columns}
          rows={rows}
          getRowId={(row) => row.id}
          caption={t("periods.list.caption")}
          isLoading={isPending}
          emptyState={t("periods.list.empty")}
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
      )}
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
