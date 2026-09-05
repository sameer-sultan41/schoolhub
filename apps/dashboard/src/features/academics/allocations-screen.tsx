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
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@schoolhub/ui";
import { isCursorPagination } from "@schoolhub/types";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useId, useMemo, useState } from "react";
import { Can } from "@/components/can";
import { ACADEMICS_PAGE_SIZE, ALL } from "@/features/academics/academics-constants";
import { ApiErrorAlert } from "@/features/academics/academics-error-alert";
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

  const [academicSessionId, setAcademicSessionId] = useState<string>(ALL);
  const [sectionId, setSectionId] = useState<string>(ALL);
  const [subjectId, setSubjectId] = useState<string>(ALL);
  const [staffId, setStaffId] = useState<string>(ALL);

  const filters = useMemo(
    () => ({
      ...(academicSessionId !== ALL ? { academic_session_id: academicSessionId } : {}),
      ...(sectionId !== ALL ? { section_id: sectionId } : {}),
      ...(subjectId !== ALL ? { subject_id: subjectId } : {}),
      ...(staffId !== ALL ? { staff_id: staffId } : {}),
    }),
    [academicSessionId, sectionId, subjectId, staffId],
  );
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
          page_size: ACADEMICS_PAGE_SIZE,
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
      className: "tabular-nums",
      cell: (row) => row.weekly_periods ?? EMPTY,
    },
    {
      id: "effective",
      header: t("allocations.columns.effective"),
      className: "tabular-nums",
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
          <span className="text-xs font-medium text-muted-foreground">{t("fields.section")}</span>
          <Select value={sectionId} onValueChange={setSectionId}>
            <SelectTrigger aria-label={t("fields.section")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t("filters.all")}</SelectItem>
              {(sections.data ?? []).map((section) => (
                <SelectItem key={section.id} value={section.id}>
                  {sectionLabels.get(section.id) ?? section.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="w-40 space-y-1">
          <span className="text-xs font-medium text-muted-foreground">{t("fields.subject")}</span>
          <Select value={subjectId} onValueChange={setSubjectId}>
            <SelectTrigger aria-label={t("fields.subject")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t("filters.all")}</SelectItem>
              {(subjects.data ?? []).map((option) => (
                <SelectItem key={option.id} value={option.id}>
                  {option.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="w-40 space-y-1">
          <span className="text-xs font-medium text-muted-foreground">{t("fields.teacher")}</span>
          <Select value={staffId} onValueChange={setStaffId}>
            <SelectTrigger aria-label={t("fields.teacher")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t("filters.all")}</SelectItem>
              {(staff.data ?? []).map((teacher) => (
                <SelectItem key={teacher.id} value={teacher.id}>
                  {`${teacher.first_name} ${teacher.last_name}`}
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
          caption={t("allocations.list.caption")}
          isLoading={isPending}
          emptyState={t("allocations.list.empty")}
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
