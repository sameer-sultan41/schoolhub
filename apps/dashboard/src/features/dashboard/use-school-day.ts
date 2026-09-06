"use client";

import { collectPages } from "@schoolhub/api-client";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import {
  DASHBOARD_REFERENCE_GC_TIME_MS,
  DASHBOARD_REFERENCE_STALE_TIME_MS,
  RESTRICTED_ROLE_SLUGS,
  TIMETABLE_VIEW_PERMISSION,
} from "@/features/dashboard/dashboard-constants";
import type {
  MyTimetable,
  MyTimetableSlot,
  PeriodRecord,
} from "@/features/timetable/timetable-types";
import { useSession } from "@/hooks/use-session";
import { apiClient } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { queryKeys } from "@/lib/query-client";

/** One stretch of the viewer's day — a taught period, a free period, or a break. */
export interface DayBlock {
  key: string;
  label: string;
  startMinutes: number;
  endMinutes: number;
  isBreak: boolean;
  /** `"Grade 5-A · Mathematics · Ayesha Khan · Room 12"`, or null when nothing is on. */
  detail: string | null;
  isSubstituted: boolean;
}

/** The viewer's whole day, already in the units the band draws with. */
export interface SchoolDay {
  blocks: DayBlock[];
  dayStartMinutes: number;
  dayEndMinutes: number;
  nowMinutes: number;
  currentBlockKey: string | null;
}

const MINUTES_PER_HOUR = 60;
const MINUTES_PER_DAY = 24 * MINUTES_PER_HOUR;
const DETAIL_SEPARATOR = " · ";

/** DRF's TimeField renders `"HH:MM:SS"`; `"HH:MM"` is accepted too rather than assumed away. */
const TIME_PATTERN = /^(\d{1,2}):([0-5]\d)(?::[0-5]\d)?$/;

/**
 * `"08:45:00"` -> `525`, and `null` for anything that is not a time of day.
 *
 * Null rather than `NaN` or a throw: a malformed time is a bug on the other side of the
 * wire, and the honest response on a dashboard is to leave that one block out — not to
 * blank the whole band, and certainly not to draw a block of negative width.
 */
export function timeToMinutes(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = TIME_PATTERN.exec(value);
  if (!match) return null;

  const [, rawHours, rawMinutes] = match;
  if (rawHours === undefined || rawMinutes === undefined) return null;

  const hours = Number(rawHours);
  if (hours > 23) return null;
  return hours * MINUTES_PER_HOUR + Number(rawMinutes);
}

/**
 * `day_of_week` for a `Date`.
 *
 * `Date.prototype.getDay()` is Sunday-based; the API's `day_of_week` follows Python's
 * `date.weekday()`, which is Monday-based (apps/timetable/services.py's
 * `_slot_weekday` says so explicitly). Hence the shift — the same conversion
 * timetable-constants.ts's `weekdayFromIsoDate` does for an ISO string.
 */
export function weekdayOf(now: Date): number {
  return (now.getDay() + 6) % 7;
}

/** Local calendar date as `YYYY-MM-DD`. Local, not UTC: "today" is the viewer's today. */
export function toIsoDate(now: Date): string {
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${String(now.getFullYear())}-${month}-${day}`;
}

/**
 * What is actually happening in one cell, as one line.
 *
 * A confirmed substitution overlays the cell rather than adding a field to it
 * (`MyTimetableSlot.substitution`), and it can move the room as well as the teacher —
 * §6's ad-hoc room change. Reading the slot's own room for a covered period sends the
 * reader somewhere the class is not, so the overlay wins both. A null `room_id` on the
 * overlay means "keep the slot's room", which is why the fallback chain ends at the
 * slot rather than at an em dash.
 */
function slotDetail(slot: MyTimetableSlot): string | null {
  const cover = slot.substitution;
  const parts = [
    slot.section_name,
    slot.subject_name,
    cover ? cover.substitute_staff_name : slot.staff_name,
    cover?.room_name ?? slot.room_name,
  ].filter((part): part is string => typeof part === "string" && part.trim().length > 0);

  return parts.length > 0 ? parts.join(DETAIL_SEPARATOR) : null;
}

/**
 * Fold today's timetable rows and the bell schedule into one ordered day.
 *
 * Pure, and takes `now` as an argument, so every branch below is testable without fake
 * timers — the time arithmetic is the part of this screen most likely to be wrong and
 * least likely to be noticed.
 *
 * The bell schedule is the spine when the viewer can read it: it supplies the breaks and
 * the free periods, which are exactly the blocks `/timetables/my` does not return (it
 * returns lessons). A viewer who cannot read `/periods` — a student or a guardian, see
 * `RESTRICTED_ROLE_SLUGS` — still gets a correct, if gappier, day built from the lessons
 * alone. Neither path throws: an empty-but-valid day is a real state (a Sunday, a
 * teacher with no classes today), not an error.
 */
export function toSchoolDay(
  slots: MyTimetableSlot[],
  periods: PeriodRecord[],
  now: Date,
): SchoolDay {
  const dayOfWeek = weekdayOf(now);
  const nowMinutes = Math.min(
    MINUTES_PER_DAY,
    now.getHours() * MINUTES_PER_HOUR + now.getMinutes(),
  );

  // First row wins per period: `/timetables/my` returns the caller's whole week, and a
  // teacher can hold at most one slot per (weekday, period) — a duplicate would be a
  // hard conflict the API refuses to publish.
  const todaysSlots = new Map<string, MyTimetableSlot>();
  for (const slot of slots) {
    if (slot.day_of_week !== dayOfWeek) continue;
    if (!todaysSlots.has(slot.period_id)) todaysSlots.set(slot.period_id, slot);
  }

  const blocks: DayBlock[] = [];
  const fromSchedule = new Set<string>();

  for (const period of periods) {
    // `weekdays: null` means "the tenant's working days" (models.py), so a period that
    // names no weekdays applies to every day the school runs — including this one.
    if (period.weekdays !== null && !period.weekdays.includes(dayOfWeek)) continue;

    const startMinutes = timeToMinutes(period.start_time);
    const endMinutes = timeToMinutes(period.end_time);
    if (startMinutes === null || endMinutes === null || endMinutes <= startMinutes) continue;

    const slot = todaysSlots.get(period.id);
    fromSchedule.add(period.id);
    blocks.push({
      key: period.id,
      label: period.name,
      startMinutes,
      endMinutes,
      isBreak: period.is_break,
      detail: period.is_break || !slot ? null : slotDetail(slot),
      isSubstituted: !period.is_break && slot?.substitution != null,
    });
  }

  // Lessons whose period the bell schedule did not supply — every lesson when the viewer
  // cannot read `/periods` at all, and a campus-specific period otherwise.
  for (const [periodId, slot] of todaysSlots) {
    if (fromSchedule.has(periodId)) continue;

    const startMinutes = timeToMinutes(slot.start_time);
    const endMinutes = timeToMinutes(slot.end_time);
    if (startMinutes === null || endMinutes === null || endMinutes <= startMinutes) continue;

    blocks.push({
      key: periodId,
      label: slot.period_name,
      startMinutes,
      endMinutes,
      isBreak: false,
      detail: slotDetail(slot),
      isSubstituted: slot.substitution !== null,
    });
  }

  blocks.sort(
    (left, right) => left.startMinutes - right.startMinutes || left.endMinutes - right.endMinutes,
  );

  // Half-open on purpose: at 09:00 sharp the 09:00–09:45 period is what is happening,
  // not the 08:15–09:00 one that has just ended.
  const current = blocks.find(
    (block) => nowMinutes >= block.startMinutes && nowMinutes < block.endMinutes,
  );

  return {
    blocks,
    dayStartMinutes: blocks[0]?.startMinutes ?? 0,
    dayEndMinutes: blocks.reduce((latest, block) => Math.max(latest, block.endMinutes), 0),
    nowMinutes,
    currentBlockKey: current?.key ?? null,
  };
}

/**
 * Where "now" sits along the day, 0–100.
 *
 * Clamped, because a viewer looking at the dashboard at 06:00 or at 21:00 is outside the
 * school day and a marker off the end of the strip reads as a rendering bug rather than
 * as "school is not in session". A day with no measurable span answers 0 rather than
 * dividing by zero.
 */
export function markerPercent(day: SchoolDay): number {
  const span = day.dayEndMinutes - day.dayStartMinutes;
  if (span <= 0) return 0;
  const ratio = (day.nowMinutes - day.dayStartMinutes) / span;
  return Math.min(100, Math.max(0, ratio * 100));
}

export interface SchoolDayResult {
  day: SchoolDay;
  /** The date the timetable was asked for — `YYYY-MM-DD`, the viewer's local today. */
  date: string;
  now: Date;
  isPending: boolean;
  /** False when the viewer holds no timetable key at all; the band renders nothing. */
  canView: boolean;
  error: unknown;
}

/**
 * The bell-schedule band's data.
 *
 * Dated, not the base grid: `GET /timetables/my?date=…` resolves confirmed
 * substitutions, which override one cell for specific dates only (§7.2). Asking without
 * a date would show the reader a teacher who is not actually taking the class today.
 *
 * `now` is captured once per mount rather than per render: it feeds the query key
 * through the date, and a value that changes every render would refetch the timetable on
 * every re-render. The marker is therefore accurate to the moment the screen was opened,
 * which is what a dashboard promises.
 */
export function useSchoolDay(): SchoolDayResult {
  const { user } = useSession();
  const now = useMemo(() => new Date(), []);
  const date = toIsoDate(now);

  const canView = hasPermission(user, TIMETABLE_VIEW_PERMISSION);
  const isRestricted = (user?.roles ?? []).some((role) =>
    RESTRICTED_ROLE_SLUGS.includes(role.slug),
  );
  const canReadSchedule = canView && !isRestricted;

  // Same key shape as MyTimetableScreen's, so opening the full timetable for today reuses
  // this response instead of refetching it.
  const timetable = useQuery({
    queryKey: queryKeys.list("timetable", "timetables-my", { date }),
    queryFn: async () => {
      const result = await apiClient.get<MyTimetable>("/timetables/my", { query: { date } });
      return result.data;
    },
    enabled: canView,
  });

  const periods = useQuery({
    queryKey: queryKeys.list("timetable", "periods", { scope: "all" }),
    queryFn: () => collectPages<PeriodRecord>(apiClient, "/periods"),
    enabled: canReadSchedule,
    staleTime: DASHBOARD_REFERENCE_STALE_TIME_MS,
    gcTime: DASHBOARD_REFERENCE_GC_TIME_MS,
  });

  const day = useMemo(
    () => toSchoolDay(timetable.data?.slots ?? [], periods.data ?? [], now),
    [timetable.data, periods.data, now],
  );

  return {
    day,
    date,
    now,
    // A disabled query sits at `pending` forever, so each half is only counted while it
    // is actually allowed to run — otherwise the band would spin for a student who can
    // never fetch the bell schedule.
    isPending: canView && (timetable.isPending || (canReadSchedule && periods.isPending)),
    canView,
    // The bell schedule is an enrichment; only the timetable failing is worth reporting.
    error: timetable.error,
  };
}
