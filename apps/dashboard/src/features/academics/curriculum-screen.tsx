"use client";

import { fetchPage } from "@schoolhub/api-client";
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
import { isCursorPagination } from "@schoolhub/types";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpen } from "lucide-react";
import { useTranslations } from "next-intl";
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
import { useCursorPager } from "@/hooks/use-cursor-pager";
import { useTableParams } from "@/hooks/use-table-params";
import { apiClient } from "@/lib/auth";
import { queryKeys } from "@/lib/query-client";

/** Em dash for a missing optional value — the house convention. */
const EMPTY = "—";

/**
 * The class × subject curriculum grid for a session (§5.1).
 *
 * A flat, filterable list rather than a literal matrix: the API paginates rows
 * by cursor, and a matrix needs every row at once to know its own shape. The
 * session filter is what makes it read as a grid — pick a session and the list
 * is that session's curriculum.
 */
export function CurriculumScreen() {
  const t = useTranslations("academics");
  const tCommon = useTranslations("common");
  const pager = useCursorPager();

  const sessions = useAcademicSessions();
  const classes = useClasses();
  const subjects = useSubjects();
  const campuses = useCampuses();

  const table = useTableParams({
    filterKeys: ["academic_session_id", "class_id", "campus_id", "is_elective"],
    pageSize: ACADEMICS_PAGE_SIZE,
  });
  const academicSessionId = table.filter("academic_session_id");
  const classId = table.filter("class_id");
  const campusId = table.filter("campus_id");
  const isElective = table.filter("is_elective");

  const filters = table.query;
  pager.syncFilterKey(JSON.stringify(filters));

  const { data, isPending, isFetching, error } = useQuery({
    queryKey: queryKeys.list("academics", "class-subjects", { ...filters, cursor: pager.cursor }),
    queryFn: () =>
      fetchPage<CurriculumRecord>(apiClient, "/class-subjects", {
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
  const subjectNames = useMemo(
    () => new Map((subjects.data ?? []).map((option) => [option.id, option.name])),
    [subjects.data],
  );
  const campusNames = useMemo(
    () => new Map((campuses.data ?? []).map((campus) => [campus.id, campus.name])),
    [campuses.data],
  );

  const rows = data?.items ?? [];
  // /class-subjects paginates by cursor, never offset — narrowed for the same
  // reason staff-table.tsx narrows its own pagination meta.
  const pagination =
    data?.pagination && isCursorPagination(data.pagination) ? data.pagination : undefined;

  const columns: DataTableColumn<CurriculumRecord>[] = [
    {
      id: "session",
      header: t("fields.academicSession"),
      cell: (row) => sessionNames.get(row.academic_session_id) ?? EMPTY,
    },
    {
      id: "class",
      header: t("fields.class"),
      cell: (row) => classNames.get(row.class_id) ?? EMPTY,
    },
    {
      id: "subject",
      header: t("fields.subject"),
      cell: (row) => subjectNames.get(row.subject_id) ?? EMPTY,
    },
    {
      id: "campus",
      header: t("fields.campus"),
      cell: (row) =>
        row.campus_id ? (campusNames.get(row.campus_id) ?? EMPTY) : t("fields.allCampuses"),
    },
    {
      id: "kind",
      header: t("curriculum.columns.kind"),
      cell: (row) =>
        row.is_elective ? (
          <Badge variant="warning">
            {row.elective_group
              ? t("curriculum.electiveWithGroup", { group: row.elective_group })
              : t("curriculum.elective")}
          </Badge>
        ) : (
          <Badge variant="secondary">{t("curriculum.core")}</Badge>
        ),
    },
    {
      id: "weeklyPeriods",
      header: t("fields.weeklyPeriods"),
      numeric: "measure",
      cell: (row) => row.weekly_periods,
    },
    {
      id: "actions",
      header: "",
      srLabel: t("curriculum.columns.actions"),
      className: "text-end",
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

      <DataTable
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
