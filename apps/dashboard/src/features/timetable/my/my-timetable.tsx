"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Badge, Card, EmptyState, Input, Label, Skeleton } from "@schoolhub/ui";
import { CalendarDays } from "lucide-react";

import { Toolbar, ToolbarHeading } from "@/app/(app)/shell/toolbar";
import { LoadErrorCard } from "@/components/load-error-card";
import { isIsoDate } from "@/lib/helpers";
import { resolveErrorMessage } from "@/lib/error-message";
import { queryKeys } from "@/lib/query-client";
import { Services, type EffectiveSlotRecord } from "@/services";
import {
  toShortTimeRange,
  visibleWeekdays,
} from "@/services/modules/timetable-slots/timetable-slots-helper";

/** One row of the week: a period the viewer has a class in, in the day's order. */
interface PeriodRow {
  id: string;
  name: string;
  sequence: number;
  span: string;
}

function periodRows(slots: readonly EffectiveSlotRecord[]): PeriodRow[] {
  const byId = new Map<string, PeriodRow>();
  for (const slot of slots) {
    byId.set(slot.period_id, {
      id: slot.period_id,
      name: slot.period_name,
      sequence: slot.period_sequence,
      span: toShortTimeRange(slot.start_time, slot.end_time),
    });
  }
  return [...byId.values()].sort((a, b) => a.sequence - b.sequence);
}

/** One class in a cell: subject, section and room, and who covers it on the chosen date. */
function MySlotEntry({ slot }: { slot: EffectiveSlotRecord }) {
  const t = useTranslations("timetable");
  return (
    <span className="block space-y-0.5">
      <span className="block font-medium text-foreground">
        {slot.subject_name ?? t("grid.noSubject")}
      </span>
      <span className="block text-xs text-muted-foreground">
        {[slot.section_name, slot.substitution?.room_name ?? slot.room_name]
          .filter(Boolean)
          .join(" · ")}
      </span>
      {slot.substitution && (
        <Badge variant="warning" appearance="light" size="sm">
          {t("my.coverBy", { name: slot.substitution.substitute_staff_name })}
        </Badge>
      )}
    </span>
  );
}

/**
 * `/timetable/my`: the viewer's own published week (a teacher's classes and the cover they
 * give; a student's or guardian's section), from `/timetables/my`. Without a date it is the
 * current week; with one, the week in force that day with confirmed cover marked. Every
 * label comes from the response itself, so no reference list is requested.
 */
export function MyTimetable() {
  const t = useTranslations("timetable");
  const tErrors = useTranslations("errors");
  const [date, setDate] = useState("");
  const forDate = isIsoDate(date) ? date : undefined;

  const query = useQuery({
    queryKey: queryKeys.myTimetable(forDate),
    queryFn: () => Services.timetableSlots.fetchMyTimetable(forDate),
  });
  const slots = useMemo(() => query.data ?? [], [query.data]);
  const rows = useMemo(() => periodRows(slots), [slots]);
  const weekdays = useMemo(() => visibleWeekdays(slots), [slots]);
  // A list per cell: a guardian's children in different sections can share a period.
  const byCell = useMemo(() => {
    const index = new Map<string, EffectiveSlotRecord[]>();
    for (const slot of slots) {
      const key = `${slot.day_of_week}:${slot.period_id}`;
      index.set(key, [...(index.get(key) ?? []), slot]);
    }
    return index;
  }, [slots]);

  function body() {
    if (query.isPending) return <Skeleton className="h-80 w-full" />;
    if (query.isError) {
      return (
        <LoadErrorCard
          message={resolveErrorMessage(query.error, tErrors, t("my.loadError"))}
          onRetry={() => {
            void query.refetch();
          }}
        />
      );
    }
    if (slots.length === 0) {
      return (
        <Card>
          <EmptyState
            icon={CalendarDays}
            title={t("my.emptyTitle")}
            description={t("my.emptyDescription")}
          />
        </Card>
      );
    }
    return (
      <div className="overflow-x-auto">
        <table className="w-full min-w-3xl border-collapse text-sm">
          <caption className="sr-only">{t("my.caption")}</caption>
          <thead>
            <tr>
              <th scope="col" className="border border-border px-3 py-2 text-start">
                {t("fields.period")}
              </th>
              {weekdays.map((day) => (
                <th key={day} scope="col" className="border border-border px-3 py-2 text-start">
                  {t(`weekdays.${day}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <th scope="row" className="border border-border px-3 py-2 text-start align-top">
                  <span className="font-medium text-foreground">{row.name}</span>
                  <span className="block text-xs text-muted-foreground tabular-nums">
                    {row.span}
                  </span>
                </th>
                {weekdays.map((day) => {
                  const inCell = byCell.get(`${day}:${row.id}`) ?? [];
                  return (
                    <td key={day} className="border border-border px-3 py-2 align-top">
                      {inCell.length > 0 ? (
                        <span className="block space-y-2">
                          {inCell.map((slot) => (
                            <MySlotEntry key={slot.id} slot={slot} />
                          ))}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">{t("my.free")}</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <>
      <Toolbar>
        <ToolbarHeading title={t("my.title")} description={t("my.summary")} />
      </Toolbar>
      <div className="mb-5 flex max-w-xs flex-col gap-1.5">
        <Label htmlFor="my-timetable-date">{t("my.dateLabel")}</Label>
        <Input
          id="my-timetable-date"
          type="date"
          aria-describedby="my-timetable-date-hint"
          value={date}
          onChange={(event) => {
            setDate(event.target.value);
          }}
        />
        <p id="my-timetable-date-hint" className="text-xs text-muted-foreground">
          {t("my.dateHint")}
        </p>
      </div>
      {body()}
    </>
  );
}
