"use client";

import { collectPages } from "@schoolhub/api-client";
import {
  Badge,
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@schoolhub/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { Can } from "@/components/can";
import { CellConflicts, ConflictList, conflictsBySlot } from "@/features/timetable/conflict-list";
import { conflictsFromError } from "@/features/timetable/publish-conflicts";
import { SlotEditorDialog } from "@/features/timetable/slot-form";
import { DEFAULT_VISIBLE_WEEKDAYS, WEEKDAYS } from "@/features/timetable/timetable-constants";
import { ApiErrorAlert } from "@/features/timetable/timetable-error-alert";
import { TimetableNav } from "@/features/timetable/timetable-nav";
import {
  readConflicts,
  type PeriodRecord,
  type PublishResult,
  type TimetableConflict,
  type TimetableSlotRecord,
  type ValidationResult,
} from "@/features/timetable/timetable-types";
import {
  usePeriodOptions,
  useRoomOptions,
  useSectionOptions,
  useSubjectOptions,
  useTeachingStaffOptions,
} from "@/features/timetable/use-timetable-reference-data";
import { useAcademicSessions, useClasses } from "@/features/students/use-reference-data";
import { apiClient } from "@/lib/auth";
import { queryKeys } from "@/lib/query-client";

const EMPTY = "—";

interface EditingCell {
  dayOfWeek: number;
  periodId: string;
  slot?: TimetableSlotRecord;
}

/**
 * The week grid for one section (§5.2): weekday columns, period rows, one cell
 * per (weekday, period).
 *
 * Every write answers with `meta.conflicts` and the findings are rendered against
 * the cells they name, not only in the panel — `Conflict.slot_ids` lists both
 * sides of a clash precisely so a client can highlight both.
 *
 * `collectPages`, not `fetchPage` + `useCursorPager`: a grid is not a pageable
 * list. One section's week is around forty cells, which already exceeds the
 * 25-row cursor default, and a page boundary drawn through Wednesday would hide
 * real cells while looking complete. Bounded by section *and* session, so this is
 * the same "small, complete set" case as an option list.
 */
export function WeekGridScreen() {
  const t = useTranslations("timetable");
  const tCommon = useTranslations("common");
  const queryClient = useQueryClient();

  const sessions = useAcademicSessions();
  const classes = useClasses();
  const sections = useSectionOptions();
  const periods = usePeriodOptions();
  const subjects = useSubjectOptions();
  const staff = useTeachingStaffOptions();
  const rooms = useRoomOptions();

  const [academicSessionId, setAcademicSessionId] = useState("");
  const [sectionId, setSectionId] = useState("");
  const [editing, setEditing] = useState<EditingCell | null>(null);
  /** Findings from the last write, `:validate` run, or refused publish. Held in
   * component state rather than the query cache: they describe an action the user
   * just took, not a server resource, and re-fetching the grid must not silently
   * clear them. */
  const [conflicts, setConflicts] = useState<TimetableConflict[]>([]);

  const isReady = Boolean(academicSessionId && sectionId);

  const slots = useQuery({
    queryKey: queryKeys.list("timetable", "timetable-slots", {
      academic_session_id: academicSessionId,
      section_id: sectionId,
    }),
    queryFn: () =>
      collectPages<TimetableSlotRecord>(apiClient, "/timetable-slots", {
        query: { academic_session_id: academicSessionId, section_id: sectionId },
      }),
    enabled: isReady,
  });

  const validate = useMutation({
    mutationFn: async () => {
      const result = await apiClient.post<ValidationResult>(`/timetables/${sectionId}:validate`, {
        academic_session_id: academicSessionId,
      });
      return readConflicts(result.data);
    },
    onSuccess: setConflicts,
  });

  const publish = useMutation({
    mutationFn: () =>
      apiClient.post<PublishResult>(`/timetables/${sectionId}:publish`, {
        academic_session_id: academicSessionId,
      }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.module("timetable") });
      // A *successful* publish still carries findings — soft ones do not block,
      // and the user should still see them (services.publish_section_timetable
      // returns `conflicts` on the happy path too).
      setConflicts(readConflicts(result.data));
    },
    onError: (error: unknown) => {
      // 422 with the conflict list is the documented answer when hard conflicts
      // remain (§16). Render it; never swallow it.
      setConflicts(conflictsFromError(error));
    },
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
  const roomNames = useMemo(
    () => new Map((rooms.data ?? []).map((room) => [room.id, room.code])),
    [rooms.data],
  );

  // Memoised, not `slots.data ?? []` inline: the fallback allocates a fresh
  // array on every render whenever the query has no data, so both `useMemo`s
  // below would re-run each time and the grid — the heaviest screen in the app —
  // would rebuild its cell index for nothing.
  const slotRows = useMemo(() => slots.data ?? [], [slots.data]);

  /** (weekday, period) → the slot in that cell. A published slot and its draft
   * replacement can both be current, and the draft is what the builder edits, so
   * the draft wins the cell. */
  const byCell = useMemo(() => {
    const index = new Map<string, TimetableSlotRecord>();
    for (const slot of slotRows) {
      if (slot.effective_to) continue;
      const key = `${slot.day_of_week}:${slot.period_id}`;
      const existing = index.get(key);
      if (!existing || (existing.status === "published" && slot.status === "draft")) {
        index.set(key, slot);
      }
    }
    return index;
  }, [slotRows]);

  const conflictIndex = useMemo(() => conflictsBySlot(conflicts), [conflicts]);

  /** The five weekdays a school week normally shows, plus any weekend day that
   * actually holds a slot — a Saturday school must not be silently truncated. */
  const visibleWeekdays = useMemo(() => {
    const scheduled = new Set(slotRows.map((slot) => slot.day_of_week));
    return WEEKDAYS.filter(
      (day) => (DEFAULT_VISIBLE_WEEKDAYS as readonly number[]).includes(day) || scheduled.has(day),
    );
  }, [slotRows]);

  const periodRows = periods.data ?? [];

  function cellLabel(dayOfWeek: number, period: PeriodRecord) {
    return `${t(`weekdays.${dayOfWeek}`)} · ${period.name}`;
  }

  return (
    <div className="space-y-4">
      <TimetableNav />

      <div className="flex flex-wrap items-end gap-3">
        <div className="w-48 space-y-1">
          <span className="text-xs font-medium text-muted-foreground">
            {t("fields.academicSession")}
          </span>
          <Select value={academicSessionId} onValueChange={setAcademicSessionId}>
            <SelectTrigger aria-label={t("fields.academicSession")}>
              <SelectValue placeholder={t("fields.selectSession")} />
            </SelectTrigger>
            <SelectContent>
              {(sessions.data ?? []).map((session) => (
                <SelectItem key={session.id} value={session.id}>
                  {session.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="w-48 space-y-1">
          <span className="text-xs font-medium text-muted-foreground">{t("fields.section")}</span>
          <Select value={sectionId} onValueChange={setSectionId}>
            <SelectTrigger aria-label={t("fields.section")}>
              <SelectValue placeholder={t("fields.selectSection")} />
            </SelectTrigger>
            <SelectContent>
              {(sections.data ?? []).map((section) => (
                <SelectItem key={section.id} value={section.id}>
                  {sectionLabels.get(section.id) ?? section.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-wrap gap-2">
          {/* There is no `timetable.timetable.validate` key in
              apps/api/apps/timetable/permissions.py — a validation run only reads
              drafts, so it is gated on the same key that lets you see them. */}
          <Can permission="timetable.slot.view">
            <Button
              variant="outline"
              disabled={!isReady}
              isLoading={validate.isPending}
              loadingLabel={tCommon("loading")}
              onClick={() => {
                validate.mutate();
              }}
            >
              {t("actions.validate")}
            </Button>
          </Can>
          <Can permission="timetable.timetable.publish">
            <Button
              disabled={!isReady}
              isLoading={publish.isPending}
              loadingLabel={tCommon("loading")}
              onClick={() => {
                publish.mutate();
              }}
            >
              {t("actions.publish")}
            </Button>
          </Can>
        </div>
      </div>

      {!isReady ? (
        <p className="text-sm text-muted-foreground">{t("grid.pickSection")}</p>
      ) : slots.error ? (
        <ApiErrorAlert error={slots.error} />
      ) : (
        <>
          {/* The envelope for a failed validate is shown; a failed publish is
              described by its conflict list instead, which is the whole point of
              the 422 carrying one. */}
          <ApiErrorAlert error={validate.error} />

          <div role="status" className="space-y-2">
            {publish.isError && conflicts.length === 0 ? (
              // A 422 whose details named no conflict at all (a session that is
              // not writable, a section with no draft) still has to say something.
              <ApiErrorAlert error={publish.error} />
            ) : null}
            {publish.isError ? (
              <p className="text-sm font-medium text-danger">{t("conflicts.publishBlocked")}</p>
            ) : null}
            {publish.isSuccess ? (
              <p className="text-sm font-medium text-success">
                {t("grid.published", { count: publish.data.data.published })}
              </p>
            ) : null}
            <ConflictList
              conflicts={conflicts}
              emptyMessage={validate.isSuccess ? t("conflicts.none") : undefined}
            />
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[48rem] border-collapse text-sm">
              <caption className="sr-only">{t("grid.caption")}</caption>
              <thead>
                <tr>
                  <th scope="col" className="border border-border px-3 py-2 text-start">
                    {t("fields.period")}
                  </th>
                  {visibleWeekdays.map((day) => (
                    <th key={day} scope="col" className="border border-border px-3 py-2 text-start">
                      {t(`weekdays.${day}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {periodRows.map((period) => (
                  <tr key={period.id}>
                    <th scope="row" className="border border-border px-3 py-2 text-start">
                      <span className="font-medium text-foreground">{period.name}</span>
                      <span className="block text-xs text-muted-foreground tabular-nums">
                        {`${period.start_time} – ${period.end_time}`}
                      </span>
                    </th>
                    {visibleWeekdays.map((day) => {
                      const slot = byCell.get(`${day}:${period.id}`);
                      const cellConflicts = slot ? (conflictIndex.get(slot.id) ?? []) : [];
                      const hasHard = cellConflicts.some((one) => one.severity === "hard");

                      // A break is never schedulable (§5.1) and a period that
                      // does not run on this weekday has no cell to fill.
                      const isBreak = period.is_break;
                      const runsToday = !period.weekdays || period.weekdays.includes(day);

                      if (isBreak || !runsToday) {
                        return (
                          <td
                            key={day}
                            className="border border-border bg-muted px-3 py-2 text-xs text-muted-foreground"
                          >
                            {isBreak ? t("grid.break") : t("grid.notScheduled")}
                          </td>
                        );
                      }

                      return (
                        <td
                          key={day}
                          className={`border px-1 py-1 align-top ${
                            hasHard
                              ? "border-danger/60 bg-danger/10"
                              : cellConflicts.length > 0
                                ? "border-warning/60 bg-warning/15"
                                : "border-border"
                          }`}
                        >
                          <button
                            type="button"
                            className="w-full rounded-[var(--sh-radius)] px-2 py-1.5 text-start hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                            aria-label={
                              slot
                                ? t("grid.editCell", { cell: cellLabel(day, period) })
                                : t("grid.fillCell", { cell: cellLabel(day, period) })
                            }
                            onClick={() => {
                              setEditing({ dayOfWeek: day, periodId: period.id, slot });
                            }}
                          >
                            {slot ? (
                              <span className="block space-y-0.5">
                                <span className="block font-medium text-foreground">
                                  {slot.subject_id
                                    ? (subjectNames.get(slot.subject_id) ?? EMPTY)
                                    : t("grid.noSubject")}
                                </span>
                                <span className="block text-xs text-muted-foreground">
                                  {slot.staff_id ? (staffNames.get(slot.staff_id) ?? EMPTY) : EMPTY}
                                </span>
                                <span className="block text-xs text-muted-foreground">
                                  {slot.room_id ? (roomNames.get(slot.room_id) ?? EMPTY) : EMPTY}
                                </span>
                                {slot.status === "draft" ? (
                                  <Badge variant="outline">{t("grid.draft")}</Badge>
                                ) : (
                                  <Badge variant="success">{t("grid.publishedBadge")}</Badge>
                                )}
                              </span>
                            ) : (
                              <span className="block text-xs text-muted-foreground">
                                {t("grid.emptyCell")}
                              </span>
                            )}
                          </button>
                          <CellConflicts conflicts={cellConflicts} />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            {periodRows.length === 0 ? (
              <p className="rounded-[var(--sh-radius)] border border-dashed border-border px-6 py-10 text-center text-sm text-muted-foreground">
                {t("grid.noPeriods")}
              </p>
            ) : null}
          </div>
        </>
      )}

      {editing ? (
        <SlotEditorDialog
          open
          onOpenChange={(next) => {
            if (!next) setEditing(null);
          }}
          academicSessionId={academicSessionId}
          sectionId={sectionId}
          dayOfWeek={editing.dayOfWeek}
          periodId={editing.periodId}
          slot={editing.slot}
          cellLabel={`${t(`weekdays.${editing.dayOfWeek}`)} · ${
            periodRows.find((period) => period.id === editing.periodId)?.name ?? ""
          }`}
          onConflicts={setConflicts}
        />
      ) : null}
    </div>
  );
}
