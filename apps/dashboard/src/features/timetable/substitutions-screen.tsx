"use client";

import { fetchPage } from "@schoolhub/api-client";
import { isCursorPagination } from "@schoolhub/types";
import {
  Badge,
  Button,
  DataTable,
  type DataTableColumn,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@schoolhub/ui";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useId, useMemo, useState } from "react";
import { Can } from "@/components/can";
import { SubstitutionForm } from "@/features/timetable/substitution-form";
import {
  ALL,
  SUBSTITUTION_STATUSES,
  SUBSTITUTION_STATUS_BADGE,
  TIMETABLE_PAGE_SIZE,
} from "@/features/timetable/timetable-constants";
import { ApiErrorAlert } from "@/features/timetable/timetable-error-alert";
import { TimetableNav } from "@/features/timetable/timetable-nav";
import type { SubstitutionRecord } from "@/features/timetable/timetable-types";
import { useTeachingStaffOptions } from "@/features/timetable/use-timetable-reference-data";
import { useCursorPager } from "@/hooks/use-cursor-pager";
import { apiClient } from "@/lib/auth";
import { queryKeys } from "@/lib/query-client";

const EMPTY = "—";

/**
 * Substitutions (§5.6, §7.2): the list, the proposal form, and the approve/reject
 * decision.
 *
 * A real list rather than a bounded one, so `fetchPage` + `useCursorPager` —
 * a school's substitution history grows without bound, unlike a week's grid.
 *
 * Only a *proposed* substitution is decidable: `services.decide_substitution`
 * answers 409 for anything else, so the buttons are shown only on that state.
 * That is UX, not enforcement — the API is the authority either way.
 */
export function SubstitutionsScreen() {
  const t = useTranslations("timetable");
  const tCommon = useTranslations("common");
  const pager = useCursorPager();
  const fromId = useId();
  const toId = useId();

  const staff = useTeachingStaffOptions();

  const [status, setStatus] = useState<string>(ALL);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  // §16 names the substitution endpoints but not their filters. `status` is a
  // model field and unambiguous; the date bounds follow the `date_from`/`date_to`
  // spelling this API uses elsewhere for a DateField range. If the serializer
  // lands on different names these two keys are the only thing to change.
  const filters = useMemo(
    () => ({
      ...(status !== ALL ? { status } : {}),
      ...(dateFrom ? { date_from: dateFrom } : {}),
      ...(dateTo ? { date_to: dateTo } : {}),
    }),
    [status, dateFrom, dateTo],
  );
  pager.syncFilterKey(JSON.stringify(filters));

  const { data, isPending, isFetching, error } = useQuery({
    queryKey: queryKeys.list("timetable", "teacher-substitutions", {
      ...filters,
      cursor: pager.cursor,
    }),
    queryFn: () =>
      fetchPage<SubstitutionRecord>(apiClient, "/teacher-substitutions", {
        query: {
          ...filters,
          ...(pager.cursor ? { cursor: pager.cursor } : {}),
          page_size: TIMETABLE_PAGE_SIZE,
        },
      }),
    placeholderData: keepPreviousData,
  });

  const staffNames = useMemo(
    () =>
      new Map(
        (staff.data ?? []).map((teacher) => [
          teacher.id,
          `${teacher.first_name} ${teacher.last_name}`,
        ]),
      ),
    [staff.data],
  );

  const rows = data?.items ?? [];
  const pagination =
    data?.pagination && isCursorPagination(data.pagination) ? data.pagination : undefined;

  const columns: DataTableColumn<SubstitutionRecord>[] = [
    {
      id: "date",
      header: t("fields.date"),
      className: "tabular-nums",
      cell: (row) => row.date,
    },
    {
      id: "absent",
      header: t("fields.absentTeacher"),
      cell: (row) => staffNames.get(row.absent_staff_id) ?? EMPTY,
    },
    {
      id: "substitute",
      header: t("fields.substituteTeacher"),
      cell: (row) => staffNames.get(row.substitute_staff_id) ?? EMPTY,
    },
    {
      id: "reason",
      header: t("fields.reason"),
      cell: (row) => row.reason ?? EMPTY,
    },
    {
      id: "status",
      header: t("fields.status"),
      cell: (row) => (
        <Badge variant={SUBSTITUTION_STATUS_BADGE[row.status]}>
          {t(`substitutions.status.${row.status}`)}
        </Badge>
      ),
    },
    {
      id: "actions",
      header: "",
      srLabel: t("substitutions.columns.actions"),
      className: "text-end",
      cell: (row) =>
        row.status === "proposed" ? (
          <Can permission="timetable.substitution.approve">
            <DecisionButtons substitution={row} />
          </Can>
        ) : null,
    },
  ];

  return (
    <div className="space-y-4">
      <TimetableNav />

      <div className="flex flex-wrap items-center justify-end gap-2">
        <Can permission="timetable.substitution.create">
          <SubstitutionForm />
        </Can>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="w-40 space-y-1">
          <Label htmlFor={fromId}>{t("substitutions.filters.from")}</Label>
          <Input
            id={fromId}
            type="date"
            value={dateFrom}
            onChange={(event) => {
              setDateFrom(event.target.value);
            }}
          />
        </div>
        <div className="w-40 space-y-1">
          <Label htmlFor={toId}>{t("substitutions.filters.to")}</Label>
          <Input
            id={toId}
            type="date"
            value={dateTo}
            onChange={(event) => {
              setDateTo(event.target.value);
            }}
          />
        </div>
        <div className="w-40 space-y-1">
          <span className="text-xs font-medium text-muted-foreground">{t("fields.status")}</span>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger aria-label={t("fields.status")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t("filters.all")}</SelectItem>
              {SUBSTITUTION_STATUSES.map((value) => (
                <SelectItem key={value} value={value}>
                  {t(`substitutions.status.${value}`)}
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
          caption={t("substitutions.list.caption")}
          isLoading={isPending}
          emptyState={t("substitutions.list.empty")}
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
 * `:approve` / `:reject` — §7.2's decision step, gated on
 * `timetable.substitution.approve`, which only a vice principal or principal
 * holds. The proposer (a school admin, via `timetable.substitution.create`)
 * deliberately cannot approve their own proposal.
 */
function DecisionButtons({ substitution }: { substitution: SubstitutionRecord }) {
  const t = useTranslations("timetable");
  const tCommon = useTranslations("common");
  const queryClient = useQueryClient();

  const decide = useMutation({
    mutationFn: (action: "approve" | "reject") =>
      apiClient.post(`/teacher-substitutions/${substitution.id}:${action}`, {}),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.module("timetable") });
    },
  });

  return (
    // A <div>, not a <span>: ApiErrorAlert renders a block-level Alert, and a
    // <div> inside a <span> is invalid nesting that React warns about at runtime.
    <div className="flex flex-col items-end gap-2">
      <div className="flex justify-end gap-2">
        <Button
          variant="outline"
          size="sm"
          isLoading={decide.isPending && decide.variables === "approve"}
          loadingLabel={tCommon("loading")}
          onClick={() => {
            decide.mutate("approve");
          }}
        >
          {t("substitutions.actions.approve")}
        </Button>
        <Button
          variant="danger"
          size="sm"
          isLoading={decide.isPending && decide.variables === "reject"}
          loadingLabel={tCommon("loading")}
          onClick={() => {
            decide.mutate("reject");
          }}
        >
          {t("substitutions.actions.reject")}
        </Button>
      </div>
      <ApiErrorAlert error={decide.error} />
    </div>
  );
}
