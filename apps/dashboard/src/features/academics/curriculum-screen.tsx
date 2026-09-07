"use client";

import { fetchPage } from "@schoolhub/api-client";
import {
  Badge,
  BadgeDot,
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
import { isOffsetPagination } from "@schoolhub/types";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpen } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { ApiErrorAlert } from "@/components/api-error-alert";
import { Can } from "@/components/can";
import { FilterBar } from "@/components/filter-bar";
import { ACADEMICS_PAGE_SIZE, ALL } from "@/features/academics/academics-constants";
import { AcademicsNav } from "@/features/academics/academics-nav";
import type { CurriculumRecord } from "@/features/academics/academics-types";
import { CloneCurriculumDialog } from "@/features/academics/clone-curriculum-dialog";
import { CurriculumForm } from "@/features/academics/curriculum-form";
import { useSubjects } from "@/features/academics/use-academics-reference-data";
import {
  useAcademicSessions,
  useCampuses,
  useClasses,
} from "@/features/students/use-reference-data";
import { useTableParams } from "@/hooks/use-table-params";
import { apiClient } from "@/lib/auth";
import { formatCount } from "@/lib/format";
import { queryKeys } from "@/lib/query-client";

/** Em dash for a missing optional value — the house convention. */
const EMPTY = "—";

/**
 * The class × subject curriculum grid for a session (§5.1).
 *
 * A flat, filterable list rather than a literal matrix: the API pages the rows,
 * and a matrix needs every row at once to know its own shape. The session filter
 * is what makes it read as a grid — pick a session and the list is that session's
 * curriculum.
 */
export function CurriculumScreen() {
  const t = useTranslations("academics");
  const tCommon = useTranslations("common");
  const locale = useLocale();

  const sessions = useAcademicSessions();
  const classes = useClasses();
  const subjects = useSubjects();
  const campuses = useCampuses();

  const table = useTableParams({
    filterKeys: ["academic_session_id", "class_id", "campus_id", "is_elective"],
    pageSize: ACADEMICS_PAGE_SIZE,
    // `/class-subjects` declares an `ordering_fields` allowlist now — the four
    // annotated `*_name` aliases plus the real columns — so the headers can sort.
    sortLabels: {
      ascending: (column) => tCommon("sortAscending", { column }),
      descending: (column) => tCommon("sortDescending", { column }),
    },
  });
  const academicSessionId = table.filter("academic_session_id");
  const classId = table.filter("class_id");
  const campusId = table.filter("campus_id");
  const isElective = table.filter("is_elective");

  // `query` already carries `page` and `page_size` alongside the filters, so the
  // request is the hook's output spread straight in — there is no cursor to thread
  // through any more.
  const filters = table.query;

  const { data, isPending, error } = useQuery({
    queryKey: queryKeys.list("academics", "class-subjects", filters),
    queryFn: () => fetchPage<CurriculumRecord>(apiClient, "/class-subjects", { query: filters }),
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
  const subjectNames = useMemo(
    () => new Map((subjects.data ?? []).map((option) => [option.id, option.name])),
    [subjects.data],
  );
  const campusNames = useMemo(
    () => new Map((campuses.data ?? []).map((campus) => [campus.id, campus.name])),
    [campuses.data],
  );

  const rows = data?.items ?? [];
  // /class-subjects pages by NUMBER now, never by cursor — narrowed for the same
  // reason staff-table.tsx narrows its own pagination meta.
  const pagination =
    data?.pagination && isOffsetPagination(data.pagination) ? data.pagination : undefined;

  // The reader's own page, not the one the server echoed. `keepPreviousData` holds the
  // previous page's rows — and therefore its meta — in place while the next one loads,
  // so reading the number back off the response would leave the pager sitting on the
  // page just left for a whole round trip after the press.
  const firstRowOnPage = (table.page - 1) * table.pageSize + 1;
  const lastRowOnPage = Math.min(table.page * table.pageSize, pagination?.total_count ?? 0);

  const columns: DataTableColumn<CurriculumRecord>[] = [
    {
      id: "session",
      header: t("fields.academicSession"),
      sortKey: "session_name",
      cell: (row) => sessionNames.get(row.academic_session_id) ?? EMPTY,
      skeleton: <Skeleton className="h-4 w-24" />,
    },
    {
      id: "class",
      header: t("fields.class"),
      sortKey: "class_name",
      cell: (row) => classNames.get(row.class_id) ?? EMPTY,
      skeleton: <Skeleton className="h-4 w-16" />,
    },
    {
      id: "subject",
      header: t("fields.subject"),
      sortKey: "subject_name",
      cell: (row) => subjectNames.get(row.subject_id) ?? EMPTY,
      skeleton: <Skeleton className="h-4 w-28" />,
    },
    {
      id: "campus",
      header: t("fields.campus"),
      sortKey: "campus_name",
      cell: (row) =>
        row.campus_id ? (campusNames.get(row.campus_id) ?? EMPTY) : t("fields.allCampuses"),
      skeleton: <Skeleton className="h-4 w-20" />,
    },
    {
      id: "kind",
      header: t("curriculum.columns.kind"),
      sortKey: "is_elective",
      // Soft, with a dot: one solid pill per row down a whole column reads as a wall of
      // colour, and the dot keeps the two kinds separable without leaning on hue alone.
      cell: (row) =>
        row.is_elective ? (
          <Badge variant="warning" appearance="soft">
            <BadgeDot />
            {row.elective_group
              ? t("curriculum.electiveWithGroup", { group: row.elective_group })
              : t("curriculum.elective")}
          </Badge>
        ) : (
          <Badge variant="secondary" appearance="soft">
            <BadgeDot />
            {t("curriculum.core")}
          </Badge>
        ),
      skeleton: <Skeleton className="h-5 w-20 rounded-full" />,
    },
    {
      id: "weeklyPeriods",
      header: t("fields.weeklyPeriods"),
      sortKey: "weekly_periods",
      numeric: "measure",
      cell: (row) => formatCount(row.weekly_periods, locale),
      // `ms-auto` because the skeleton row is rendered without the column's numeric
      // classes, so the bar would otherwise sit at the start of a column that ranges end.
      skeleton: <Skeleton className="h-4 w-8" />,
    },
    {
      id: "actions",
      header: "",
      srLabel: t("curriculum.columns.actions"),
      className: "text-end",
      // Never hideable: a row you can look at and not act on, with the menu that hid the
      // controls as the only way back, is worse than a slightly wider table.
      alwaysVisible: true,
      cell: (row) => (
        <div className="flex justify-end gap-2">
          <Can permission="academics.curriculum.update">
            <CurriculumForm mode="edit" mapping={row} />
          </Can>
          <Can permission="academics.curriculum.delete">
            <DeleteMappingDialog mapping={row} subjectName={subjectNames.get(row.subject_id)} />
          </Can>
        </div>
      ),
      skeleton: (
        <div className="flex justify-end gap-2">
          <Skeleton className="h-8 w-14" />
          <Skeleton className="h-8 w-16" />
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <AcademicsNav />

      <div className="flex flex-wrap items-center justify-end gap-2">
        <Can permission="academics.curriculum.create">
          <CloneCurriculumDialog />
        </Can>
        <Can permission="academics.curriculum.create">
          <CurriculumForm mode="create" />
        </Can>
      </div>

      <DataTable
        toolbar={
          <FilterBar
            selects={[
              {
                id: "academicSession",
                label: t("fields.academicSession"),
                value: academicSessionId,
                onChange: (value) => {
                  table.setFilter("academic_session_id", value);
                },
                options: (sessions.data ?? []).map((session) => ({
                  value: session.id,
                  label: session.name,
                })),
                allLabel: t("filters.all"),
                allValue: ALL,
                className: "w-48",
              },
              {
                id: "class",
                label: t("fields.class"),
                value: classId,
                onChange: (value) => {
                  table.setFilter("class_id", value);
                },
                options: (classes.data ?? []).map((option) => ({
                  value: option.id,
                  label: option.name,
                })),
                allLabel: t("filters.all"),
                allValue: ALL,
              },
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
              },
              {
                id: "kind",
                label: t("curriculum.columns.kind"),
                value: isElective,
                onChange: (value) => {
                  table.setFilter("is_elective", value);
                },
                options: [
                  { value: "false", label: t("curriculum.core") },
                  { value: "true", label: t("curriculum.elective") },
                ],
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
        getRowId={(row) => row.id}
        caption={t("curriculum.list.caption")}
        isLoading={isPending}
        error={error ? <ApiErrorAlert error={error} /> : undefined}
        emptyState={
          <EmptyState
            icon={BookOpen}
            title={t("curriculum.list.emptyTitle")}
            description={t("curriculum.list.emptyDescription")}
            action={
              <Can permission="academics.curriculum.create">
                <CurriculumForm mode="create" />
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

/**
 * Removing a subject from a class's curriculum. Confirmed rather than immediate:
 * §11 lets the server refuse when the row is the last option in an elective
 * group, and a silent one-click delete gives no place to show that refusal.
 */
function DeleteMappingDialog({
  mapping,
  subjectName,
}: {
  mapping: CurriculumRecord;
  subjectName: string | undefined;
}) {
  const t = useTranslations("academics");
  const tCommon = useTranslations("common");
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const mutation = useMutation({
    mutationFn: () => apiClient.delete(`/class-subjects/${mapping.id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.module("academics") });
      setOpen(false);
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="danger" size="sm">
          {t("curriculum.actions.delete")}
        </Button>
      </DialogTrigger>
      <DialogContent closeLabel={t("common.close")}>
        <DialogHeader>
          <DialogTitle>{t("curriculum.delete.title")}</DialogTitle>
          <DialogDescription>
            {t("curriculum.delete.description", { subject: subjectName ?? EMPTY })}
          </DialogDescription>
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
            {t("curriculum.actions.delete")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
