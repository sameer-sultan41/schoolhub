"use client";

import { fetchPage } from "@schoolhub/api-client";
import { isOffsetPagination } from "@schoolhub/types";
import {
  Badge,
  BadgeDot,
  Button,
  DataTable,
  type DataTableColumn,
  EmptyState,
  Input,
  Label,
  Skeleton,
} from "@schoolhub/ui";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Repeat } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useId, useMemo } from "react";
import { ApiErrorAlert } from "@/components/api-error-alert";
import { Can } from "@/components/can";
import { FilterBar } from "@/components/filter-bar";
import { PersonCell } from "@/components/person-cell";
import { SubstitutionForm } from "@/features/timetable/substitution-form";
import {
  ALL,
  SUBSTITUTION_STATUSES,
  SUBSTITUTION_STATUS_BADGE,
  TIMETABLE_PAGE_SIZE,
} from "@/features/timetable/timetable-constants";
import { TimetableNav } from "@/features/timetable/timetable-nav";
import type { SubstitutionRecord } from "@/features/timetable/timetable-types";
import { useTeachingStaffOptions } from "@/features/timetable/use-timetable-reference-data";
import { useTableParams } from "@/hooks/use-table-params";
import { apiClient } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { queryKeys } from "@/lib/query-client";

const EMPTY = "—";

/** A badge column's placeholder. A pill rather than the default text bar, so the row
 * keeps its shape when the real chip arrives. */
const BADGE_SKELETON = <Skeleton className="h-5 w-20 rounded-full" />;

/**
 * A `PersonCell` column's placeholder: the avatar disc plus the name it sits beside.
 * One bar, not two — these two columns pass no `secondary` line, because a lookup Map
 * of teacher names is all this endpoint gives them, so a second bar would be a
 * placeholder for something that never arrives.
 */
const PERSON_SKELETON = (
  <div className="flex items-center gap-2.5">
    <Skeleton className="size-8 shrink-0 rounded-full" />
    <Skeleton className="h-4 w-28" />
  </div>
);

/**
 * Substitutions (§5.6, §7.2): the list, the proposal form, and the approve/reject
 * decision.
 *
 * A real list rather than a bounded one, so `fetchPage` — a school's substitution
 * history grows with every term, unlike a week's grid. It pages by NUMBER: the
 * endpoint is on `PageNumberPagination`, and a reader chasing an approval navigates
 * by position rather than by walking forward one page at a time.
 *
 * Only a *proposed* substitution is decidable: `services.decide_substitution`
 * answers 409 for anything else, so the buttons are shown only on that state.
 * That is UX, not enforcement — the API is the authority either way.
 */
export function SubstitutionsScreen() {
  const t = useTranslations("timetable");
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const fromId = useId();
  const toId = useId();

  const staff = useTeachingStaffOptions();

  const table = useTableParams({
    filterKeys: ["status", "date__gte", "date__lte"],
    pageSize: TIMETABLE_PAGE_SIZE,
    sortLabels: {
      ascending: (column) => tCommon("sortAscending", { column }),
      descending: (column) => tCommon("sortDescending", { column }),
    },
  });
  const status = table.filter("status");
  const dateFrom = table.text("date__gte");
  const dateTo = table.text("date__lte");

  // Carries `page` already, whenever the reader is past the first one, so the request
  // and the cache key both follow the pager without either of them restating it.
  const filters = table.query;

  const { data, isPending, error } = useQuery({
    queryKey: queryKeys.list("timetable", "teacher-substitutions", filters),
    queryFn: () =>
      fetchPage<SubstitutionRecord>(apiClient, "/teacher-substitutions", { query: filters }),
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
  // `/teacher-substitutions` pages by number, not by cursor
  // (views.TeacherSubstitutionViewSet.pagination_class), so the envelope carries
  // `page`/`total_pages`. Narrowing to the other arm — which this screen used to do —
  // leaves `hasNext` permanently false and the list stuck on page one.
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

  // Every sortKey below is an entry in TeacherSubstitutionViewSet.ordering_fields. The
  // two staff columns sort on SURNAME — the endpoint annotates `*_staff_last_name` and
  // offers nothing else, which is the only half of a name a list is worth ordering by;
  // `reason` is free text the endpoint does not order at all.
  const columns: DataTableColumn<SubstitutionRecord>[] = [
    {
      id: "date",
      header: t("fields.date"),
      sortKey: "date",
      // Digits that name the row rather than measure it: aligned, but start-ranged,
      // because a reader matches a date from its first character.
      numeric: "identifier",
      cell: (row) => formatDate(row.date, locale),
      skeleton: <Skeleton className="h-4 w-24" />,
    },
    {
      id: "absent",
      header: t("fields.absentTeacher"),
      sortKey: "absent_staff_last_name",
      // No `secondary`: the name comes from a lookup Map keyed on id, and there is no
      // employee number or email on this endpoint's rows to put under it.
      cell: (row) => {
        const name = staffNames.get(row.absent_staff_id);
        return name ? <PersonCell name={name} /> : EMPTY;
      },
      skeleton: PERSON_SKELETON,
    },
    {
      id: "substitute",
      header: t("fields.substituteTeacher"),
      sortKey: "substitute_staff_last_name",
      cell: (row) => {
        const name = staffNames.get(row.substitute_staff_id);
        return name ? <PersonCell name={name} /> : EMPTY;
      },
      skeleton: PERSON_SKELETON,
    },
    {
      id: "reason",
      header: t("fields.reason"),
      // Free text with no length the model bounds, so the column is capped and the whole
      // value moves to the title: one long reason left to wrap sets the height of the
      // entire row, and every other row then reads as if it were missing something.
      cell: (row) =>
        row.reason ? (
          <span className="block max-w-[28ch] truncate" title={row.reason}>
            {row.reason}
          </span>
        ) : (
          EMPTY
        ),
      skeleton: <Skeleton className="h-4 w-40" />,
    },
    {
      id: "status",
      header: t("fields.status"),
      sortKey: "status",
      // Soft, with a dot: one solid pill on every row of a status column is a wall of
      // colour, and the dot keeps the state legible without relying on the fill.
      cell: (row) => (
        <Badge variant={SUBSTITUTION_STATUS_BADGE[row.status]} appearance="soft">
          <BadgeDot />
          {t(`substitutions.status.${row.status}`)}
        </Badge>
      ),
      skeleton: BADGE_SKELETON,
    },
    {
      id: "actions",
      header: "",
      srLabel: t("substitutions.columns.actions"),
      className: "text-end",
      // Never offered in the columns menu: hiding it leaves rows a reader can look at
      // and not act on, with the menu that hid it as the only way back.
      alwaysVisible: true,
      cell: (row) =>
        row.status === "proposed" ? (
          <Can permission="timetable.substitution.approve">
            <DecisionButtons substitution={row} />
          </Can>
        ) : null,
      skeleton: (
        <div className="flex justify-end gap-2">
          <Skeleton className="h-8 w-20" />
          <Skeleton className="h-8 w-16" />
        </div>
      ),
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

      <DataTable
        toolbar={
          <FilterBar
            selects={[
              {
                id: "status",
                label: t("fields.status"),
                value: status,
                onChange: (value) => {
                  table.setFilter("status", value);
                },
                options: SUBSTITUTION_STATUSES.map((value) => ({
                  value,
                  label: t(`substitutions.status.${value}`),
                })),
                allLabel: t("filters.all"),
                allValue: ALL,
              },
            ]}
            clearLabel={tCommon("clearFilters")}
            // The date range is this screen's own control — FilterBar renders it in the same
            // row but cannot know whether it is set, so say so explicitly.
            extrasActive={Boolean(dateFrom || dateTo)}
            onClear={table.clear}
          >
            <div className="w-40 space-y-1">
              <Label htmlFor={fromId}>{t("substitutions.filters.from")}</Label>
              <Input
                id={fromId}
                type="date"
                value={dateFrom}
                onChange={(event) => {
                  table.setText("date__gte", event.target.value);
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
                  table.setText("date__lte", event.target.value);
                }}
              />
            </div>
          </FilterBar>
        }
        columns={columns}
        rows={rows}
        getRowId={(row) => row.id}
        caption={t("substitutions.list.caption")}
        isLoading={isPending}
        error={error ? <ApiErrorAlert error={error} /> : undefined}
        emptyState={
          <EmptyState
            icon={Repeat}
            title={t("substitutions.list.emptyTitle")}
            description={t("substitutions.list.emptyDescription")}
            action={
              <Can permission="timetable.substitution.create">
                <SubstitutionForm />
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
