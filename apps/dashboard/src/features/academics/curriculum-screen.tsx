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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@schoolhub/ui";
import { isCursorPagination } from "@schoolhub/types";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { Can } from "@/components/can";
import { ACADEMICS_PAGE_SIZE, ALL } from "@/features/academics/academics-constants";
import { ApiErrorAlert } from "@/features/academics/academics-error-alert";
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

  const [academicSessionId, setAcademicSessionId] = useState<string>(ALL);
  const [classId, setClassId] = useState<string>(ALL);
  const [campusId, setCampusId] = useState<string>(ALL);
  const [isElective, setIsElective] = useState<string>(ALL);

  const filters = useMemo(
    () => ({
      ...(academicSessionId !== ALL ? { academic_session_id: academicSessionId } : {}),
      ...(classId !== ALL ? { class_id: classId } : {}),
      ...(campusId !== ALL ? { campus_id: campusId } : {}),
      ...(isElective !== ALL ? { is_elective: isElective } : {}),
    }),
    [academicSessionId, classId, campusId, isElective],
  );
  pager.syncFilterKey(JSON.stringify(filters));

  const { data, isPending, isFetching, error } = useQuery({
    queryKey: queryKeys.list("academics", "class-subjects", { ...filters, cursor: pager.cursor }),
    queryFn: () =>
      fetchPage<CurriculumRecord>(apiClient, "/class-subjects", {
        query: {
          ...filters,
          ...(pager.cursor ? { cursor: pager.cursor } : {}),
          page_size: ACADEMICS_PAGE_SIZE,
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

  if (error) {
    return (
      <div className="space-y-4">
        <AcademicsNav />
        <ApiErrorAlert error={error} />
      </div>
    );
  }

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
      className: "tabular-nums",
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

      <div className="flex flex-wrap items-end gap-3">
        <div className="w-48 space-y-1">
          <span className="text-xs font-medium text-muted-foreground">
            {t("fields.academicSession")}
          </span>
          <Select value={academicSessionId} onValueChange={setAcademicSessionId}>
            <SelectTrigger aria-label={t("fields.academicSession")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t("filters.all")}</SelectItem>
              {(sessions.data ?? []).map((session) => (
                <SelectItem key={session.id} value={session.id}>
                  {session.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="w-40 space-y-1">
          <span className="text-xs font-medium text-muted-foreground">{t("fields.class")}</span>
          <Select value={classId} onValueChange={setClassId}>
            <SelectTrigger aria-label={t("fields.class")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t("filters.all")}</SelectItem>
              {(classes.data ?? []).map((option) => (
                <SelectItem key={option.id} value={option.id}>
                  {option.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="w-40 space-y-1">
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
        <div className="w-40 space-y-1">
          <span className="text-xs font-medium text-muted-foreground">
            {t("curriculum.columns.kind")}
          </span>
          <Select value={isElective} onValueChange={setIsElective}>
            <SelectTrigger aria-label={t("curriculum.columns.kind")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t("filters.all")}</SelectItem>
              <SelectItem value="false">{t("curriculum.core")}</SelectItem>
              <SelectItem value="true">{t("curriculum.elective")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <DataTable
        columns={columns}
        rows={rows}
        getRowId={(row) => row.id}
        caption={t("curriculum.list.caption")}
        isLoading={isPending}
        emptyState={t("curriculum.list.empty")}
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
