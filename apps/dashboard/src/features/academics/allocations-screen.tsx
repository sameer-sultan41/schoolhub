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
  Input,
  Label,
} from "@schoolhub/ui";
import { isCursorPagination } from "@schoolhub/types";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { UserCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useMemo, useState } from "react";
import { ApiErrorAlert } from "@/components/api-error-alert";
import { Can } from "@/components/can";
import { FilterBar } from "@/components/filter-bar";
import { ACADEMICS_PAGE_SIZE, ALL } from "@/features/academics/academics-constants";
import { AcademicsNav } from "@/features/academics/academics-nav";
import type { TeacherAllocationRecord } from "@/features/academics/academics-types";
import { AllocationForm } from "@/features/academics/allocation-form";
import { TeacherLoadSummary } from "@/features/academics/teacher-load-summary";
import {
  useSections,
  useSubjects,
  useTeachingStaff,
} from "@/features/academics/use-academics-reference-data";
import { useAcademicSessions, useClasses } from "@/features/students/use-reference-data";
import { useCursorPager } from "@/hooks/use-cursor-pager";
import { useTableParams } from "@/hooks/use-table-params";
import { apiClient } from "@/lib/auth";
import { queryKeys } from "@/lib/query-client";

const EMPTY = "—";

/**
 * Who teaches what, to whom (§5.3), plus the per-teacher load counters §8's
 * vice_principal journey watches while filling the grid.
 *
 * The load summary needs a single session (`academic_session_id` is a required
 * query parameter), so it appears only once the session filter narrows to one —
 * an aggregate across sessions would be meaningless anyway.
 */
export function AllocationsScreen() {
  const t = useTranslations("academics");
  const tCommon = useTranslations("common");
  const pager = useCursorPager();

  const sessions = useAcademicSessions();
  const sections = useSections();
  const classes = useClasses();
  const subjects = useSubjects();
  const staff = useTeachingStaff();

  const table = useTableParams({
    filterKeys: ["academic_session_id", "section_id", "subject_id", "staff_id"],
    pageSize: ACADEMICS_PAGE_SIZE,
    sortLabels: {
      ascending: (column) => tCommon("sortAscending", { column }),
      descending: (column) => tCommon("sortDescending", { column }),
    },
  });
  const academicSessionId = table.filter("academic_session_id");
  const sectionId = table.filter("section_id");
  const subjectId = table.filter("subject_id");
  const staffId = table.filter("staff_id");

  const filters = table.query;
  pager.syncFilterKey(JSON.stringify(filters));

  const { data, isPending, isFetching, error } = useQuery({
    queryKey: queryKeys.list("academics", "teacher-subject-allocations", {
      ...filters,
      cursor: pager.cursor,
    }),
    queryFn: () =>
      fetchPage<TeacherAllocationRecord>(apiClient, "/teacher-subject-allocations", {
        query: {
          ...filters,
          ...(pager.cursor ? { cursor: pager.cursor } : {}),
        },
      }),
    placeholderData: keepPreviousData,
  });

  const classNames = useMemo(
    () => new Map((classes.data ?? []).map((option) => [option.id, option.name])),
    [classes.data],
  );
  const sectionLabels = useMemo(
    () =>
      new Map(
        (sections.data ?? []).map((section) => [
          section.id,
          `${classNames.get(section.class_id) ?? ""} ${section.name}`.trim(),
        ]),
      ),
    [sections.data, classNames],
  );
  const subjectNames = useMemo(
    () => new Map((subjects.data ?? []).map((option) => [option.id, option.name])),
    [subjects.data],
  );
  // Only *active teaching* staff are in this list, so a teacher who has since
  // resigned falls back to the em dash rather than a stale name.
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

  const columns: DataTableColumn<TeacherAllocationRecord>[] = [
    {
      id: "section",
      header: t("fields.section"),
      cell: (row) => sectionLabels.get(row.section_id) ?? EMPTY,
    },
    {
      id: "subject",
      header: t("fields.subject"),
      cell: (row) => subjectNames.get(row.subject_id) ?? EMPTY,
    },
    {
      id: "teacher",
      header: t("fields.teacher"),
      cell: (row) => staffNames.get(row.staff_id) ?? EMPTY,
    },
    {
      id: "role",
      header: t("allocations.columns.role"),
      cell: (row) =>
        row.is_primary ? (
          <Badge variant="primary">{t("allocations.primary")}</Badge>
        ) : (
          <Badge variant="secondary">{t("allocations.coTeacher")}</Badge>
        ),
    },
    {
      id: "weeklyPeriods",
      header: t("fields.weeklyPeriods"),
      numeric: "measure",
      cell: (row) => row.weekly_periods ?? EMPTY,
    },
    {
      id: "effective",
      sortKey: "effective_from",
      header: t("allocations.columns.effective"),
      numeric: "identifier",
      cell: (row) =>
        row.effective_to
          ? t("allocations.endedOn", { date: row.effective_to })
          : (row.effective_from ?? t("allocations.current")),
    },
    {
      id: "actions",
      header: "",
      srLabel: t("allocations.columns.actions"),
      className: "text-end",
      cell: (row) => (
        <div className="flex justify-end gap-2">
          <Can permission="academics.teacher-allocation.update">
            <EndAllocationDialog allocation={row} />
          </Can>
          <Can permission="academics.teacher-allocation.delete">
            <DeleteAllocationDialog allocation={row} />
          </Can>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <AcademicsNav />

      <div className="flex flex-wrap items-center justify-end gap-2">
        <Can permission="academics.teacher-allocation.create">
          <AllocationForm />
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
            id: "section",
            label: t("fields.section"),
            value: sectionId,
            onChange: (value) => {
              table.setFilter("section_id", value);
            },
            options: (sections.data ?? []).map((section) => ({
              value: section.id,
              label: sectionLabels.get(section.id) ?? section.name,
            })),
            allLabel: t("filters.all"),
            allValue: ALL,
          },
          {
            id: "subject",
            label: t("fields.subject"),
            value: subjectId,
            onChange: (value) => {
              table.setFilter("subject_id", value);
            },
            options: (subjects.data ?? []).map((option) => ({
              value: option.id,
              label: option.name,
            })),
            allLabel: t("filters.all"),
            allValue: ALL,
          },
          {
            id: "teacher",
            label: t("fields.teacher"),
            value: staffId,
            onChange: (value) => {
              table.setFilter("staff_id", value);
            },
            options: (staff.data ?? []).map((teacher) => ({
              value: teacher.id,
              label: `${teacher.first_name} ${teacher.last_name}`,
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
        getRowId={(row) => row.id}
        caption={t("allocations.list.caption")}
        isLoading={isPending}
        // Wide table, scanned down one column rather than read row by row.
        density="compact"
        error={error ? <ApiErrorAlert error={error} /> : undefined}
        emptyState={
          <EmptyState
            icon={UserCheck}
            title={t("allocations.list.emptyTitle")}
            description={t("allocations.list.emptyDescription")}
            action={
              <Can permission="academics.teacher-allocation.create">
                <AllocationForm />
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

      {academicSessionId === ALL ? (
        <p className="text-sm text-muted-foreground">{t("loadSummary.pickSession")}</p>
      ) : (
        <TeacherLoadSummary academicSessionId={academicSessionId} />
      )}
    </div>
  );
}

/**
 * §6: "reassignment mid-session preserves history (old allocation end-dated, not
 * deleted)". This is that end-dating — a PATCH of `effective_to`, which also
 * frees the one-primary-per-(section, subject) slot for the replacement.
 */
function EndAllocationDialog({ allocation }: { allocation: TeacherAllocationRecord }) {
  const t = useTranslations("academics");
  const tCommon = useTranslations("common");
  const queryClient = useQueryClient();
  const dateId = useId();

  const [open, setOpen] = useState(false);
  const [effectiveTo, setEffectiveTo] = useState("");

  const mutation = useMutation({
    mutationFn: () =>
      apiClient.patch(`/teacher-subject-allocations/${allocation.id}`, {
        effective_to: effectiveTo,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.module("academics") });
      setOpen(false);
      setEffectiveTo("");
    },
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setEffectiveTo("");
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          {t("allocations.actions.end")}
        </Button>
      </DialogTrigger>
      <DialogContent closeLabel={t("common.close")}>
        <DialogHeader>
          <DialogTitle>{t("allocations.end.title")}</DialogTitle>
          <DialogDescription>{t("allocations.end.description")}</DialogDescription>
        </DialogHeader>

        <ApiErrorAlert error={mutation.error} />

        <div className="space-y-1.5">
          <Label htmlFor={dateId}>{t("fields.effectiveTo")}</Label>
          <Input
            id={dateId}
            type="date"
            value={effectiveTo}
            onChange={(event) => {
              setEffectiveTo(event.target.value);
            }}
          />
        </div>

        <DialogFooter>
          <Button
            disabled={!effectiveTo}
            isLoading={mutation.isPending}
            loadingLabel={tCommon("loading")}
            onClick={() => {
              mutation.mutate();
            }}
          >
            {t("allocations.actions.end")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Hard removal, for an allocation entered by mistake — end-dating is the right
 * tool for a real reassignment, which is why this is the destructive-looking one. */
function DeleteAllocationDialog({ allocation }: { allocation: TeacherAllocationRecord }) {
  const t = useTranslations("academics");
  const tCommon = useTranslations("common");
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const mutation = useMutation({
    mutationFn: () => apiClient.delete(`/teacher-subject-allocations/${allocation.id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.module("academics") });
      setOpen(false);
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="danger" size="sm">
          {t("allocations.actions.delete")}
        </Button>
      </DialogTrigger>
      <DialogContent closeLabel={t("common.close")}>
        <DialogHeader>
          <DialogTitle>{t("allocations.delete.title")}</DialogTitle>
          <DialogDescription>{t("allocations.delete.description")}</DialogDescription>
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
            {t("allocations.actions.delete")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
