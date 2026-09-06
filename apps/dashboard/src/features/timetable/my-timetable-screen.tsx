"use client";

import { Badge, EmptyState, Input, Label } from "@schoolhub/ui";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { CalendarDays } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useMemo, useState } from "react";
import { ApiErrorAlert } from "@/components/api-error-alert";
import { DEFAULT_VISIBLE_WEEKDAYS, WEEKDAYS } from "@/features/timetable/timetable-constants";
import { TimetableNav } from "@/features/timetable/timetable-nav";
import type { MyTimetable, MyTimetableSlot } from "@/features/timetable/timetable-types";
import { apiClient } from "@/lib/auth";
import { queryKeys } from "@/lib/query-client";

const EMPTY = "—";

/**
 * The caller's own effective timetable — `GET /timetables/my` (§16).
 *
 * The one screen students, guardians and teachers all reach, and the reason it
 * cannot resolve anything itself: `timetable.timetable.view` is the only key
 * those roles hold, so `/sections`, `/subjects`, `/rooms` and `/staff` are all
 * closed to them. The endpoint therefore has to return display names beside the
 * ids — which is exactly what `services.effective_slots_for`'s
 * `select_related("period", "subject", "staff", "room", "section")` has already
 * fetched. See MyTimetableSlot in timetable-types.ts.
 *
 * Date-aware, because a substitution overrides one cell for specific dates only
 * (§7.2): asking without a date gives the base grid, asking with one gives what
 * actually happens that day. The date therefore belongs in the query key — a
 * cached Tuesday must never be shown as Wednesday's answer.
 */
export function MyTimetableScreen() {
  const t = useTranslations("timetable");
  const dateFieldId = useId();

  const [date, setDate] = useState("");

  const { data, isPending, error } = useQuery({
    queryKey: queryKeys.list("timetable", "timetables-my", { date }),
    queryFn: async () => {
      const result = await apiClient.get<MyTimetable>(
        "/timetables/my",
        date ? { query: { date } } : {},
      );
      return result.data;
    },
    // The grid should not blank out while a newly picked date is in flight —
    // the previous day's answer is a better placeholder than a skeleton.
    placeholderData: keepPreviousData,
  });

  const slots = useMemo(() => data?.slots ?? [], [data]);

  /** Rows come from the response, in the order the day runs. `period_sequence`
   * is the model's own daily order, and periods repeat across weekdays, so the
   * rows are the DISTINCT periods the caller actually has. */
  const periodRows = useMemo(() => {
    const rows = new Map<string, MyTimetableSlot>();
    for (const slot of slots) {
      if (!rows.has(slot.period_id)) rows.set(slot.period_id, slot);
    }
    return [...rows.values()].sort((left, right) => left.period_sequence - right.period_sequence);
  }, [slots]);

  const byCell = useMemo(() => {
    const index = new Map<string, MyTimetableSlot>();
    for (const slot of slots) index.set(`${slot.day_of_week}:${slot.period_id}`, slot);
    return index;
  }, [slots]);

  const visibleWeekdays = useMemo(() => {
    const scheduled = new Set(slots.map((slot) => slot.day_of_week));
    return WEEKDAYS.filter(
      (day) => (DEFAULT_VISIBLE_WEEKDAYS as readonly number[]).includes(day) || scheduled.has(day),
    );
  }, [slots]);

  return (
    <div className="space-y-4">
      <TimetableNav />

      <div className="flex flex-wrap items-end gap-3">
        <div className="w-48 space-y-1">
          <Label htmlFor={dateFieldId}>{t("my.dateLabel")}</Label>
          <Input
            id={dateFieldId}
            type="date"
            value={date}
            onChange={(event) => {
              setDate(event.target.value);
            }}
          />
        </div>
        <p className="text-sm text-muted-foreground">{t("my.dateHint")}</p>
      </div>

      {error ? (
        <ApiErrorAlert error={error} />
      ) : isPending ? (
        <p className="text-sm text-muted-foreground">{t("my.loading")}</p>
      ) : slots.length === 0 ? (
        // No action: the viewer of this screen is a student, guardian or teacher, and
        // publishing a timetable is not a thing any of them can do. An empty state that
        // offered a button here would be pointing at a door they cannot open.
        <EmptyState
          icon={CalendarDays}
          title={t("my.emptyTitle")}
          description={t("my.emptyDescription")}
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[48rem] border-collapse text-sm">
            <caption className="sr-only">{t("my.caption")}</caption>
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
              {periodRows.map((row) => (
                <tr key={row.period_id}>
                  <th scope="row" className="border border-border px-3 py-2 text-start">
                    <span className="font-medium text-foreground">{row.period_name}</span>
                    <span className="block text-xs text-muted-foreground tabular-nums">
                      {`${row.start_time} – ${row.end_time}`}
                    </span>
                  </th>
                  {visibleWeekdays.map((day) => {
                    const slot = byCell.get(`${day}:${row.period_id}`);
                    if (!slot) {
                      return (
                        <td
                          key={day}
                          className="border border-border px-3 py-2 text-xs text-muted-foreground"
                        >
                          {t("my.free")}
                        </td>
                      );
                    }

                    // The overlay wins the whole cell, not just the name: §6's
                    // ad-hoc room change moves the class for that date, so a
                    // covered period read against the base row would send the
                    // student to the wrong room. A substitution that keeps the
                    // slot's own room carries a null `room_id`, which is why the
                    // fallback is the slot's room rather than an em dash.
                    const cover = slot.substitution;
                    return (
                      <td key={day} className="border border-border px-3 py-2 align-top">
                        <span className="block font-medium text-foreground">
                          {slot.subject_name ?? t("grid.noSubject")}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          {cover ? cover.substitute_staff_name : (slot.staff_name ?? EMPTY)}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          {cover?.room_name ?? slot.room_name ?? EMPTY}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          {slot.section_name}
                        </span>
                        {cover ? <Badge variant="warning">{t("my.substituted")}</Badge> : null}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
