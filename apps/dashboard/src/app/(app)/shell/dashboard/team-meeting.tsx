"use client";

import { useMemo } from "react";
import { MapPin, Users } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

import { Card, CardContent, Skeleton } from "@schoolhub/ui";

import { Services } from "@/services";

/** Local calendar date as `YYYY-MM-DD`. Local, not UTC: "today" is the viewer's today. */
function toIsoDate(now: Date): string {
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${String(now.getFullYear())}-${month}-${day}`;
}

/** `day_of_week` is Monday-based (Python's `date.weekday()`); JS's `getDay()` is Sunday-based. */
function weekdayOf(now: Date): number {
  return (now.getDay() + 6) % 7;
}

function timeToMinutes(value: string): number {
  const parts = value.split(":");
  return (Number(parts[0]) || 0) * 60 + (Number(parts[1]) || 0);
}

function timeRange(start: string, end: string): string {
  return `${start.slice(0, 5)} - ${end.slice(0, 5)}`;
}

/**
 * Repurposed from the vendor Metronic template's team-meeting.tsx (originally a fixed
 * Zoom meeting card) into the viewer's own current or next class today, read from their
 * real timetable.
 */
export function TeamMeeting() {
  const now = useMemo(() => new Date(), []);
  const date = useMemo(() => toIsoDate(now), [now]);

  const { data, isPending } = useQuery({
    queryKey: ["dashboard", "my-timetable", date],
    queryFn: () => Services.dashboard.fetchMyTimetable(date),
  });

  const nextSlot = useMemo(() => {
    if (!data) return null;
    const today = weekdayOf(now);
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    return (
      data
        .filter((slot) => slot.day_of_week === today)
        .sort((a, b) => timeToMinutes(a.start_time) - timeToMinutes(b.start_time))
        .find((slot) => timeToMinutes(slot.end_time) > nowMinutes) ?? null
    );
  }, [data, now]);

  if (isPending) {
    return (
      <Card className="h-full">
        <CardContent className="grow p-5 lg:p-7.5 lg:pt-6">
          <Skeleton className="mb-2 h-6 w-40" />
          <Skeleton className="mb-7.5 h-4 w-24" />
          <Skeleton className="h-20 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (!nextSlot) {
    return (
      <Card className="h-full">
        <CardContent className="flex h-full flex-col items-center justify-center gap-1 p-5 text-center lg:p-7.5">
          <span className="text-mono text-lg font-semibold">No more classes today</span>
          <span className="text-sm font-normal text-muted-foreground">
            Nothing left on your timetable for today.
          </span>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="h-full">
      <CardContent className="grow p-5 lg:p-7.5 lg:pt-6">
        <div className="mb-7.5 flex flex-col gap-1">
          <span className="text-mono text-xl font-semibold">
            {nextSlot.subject_name ?? "Class"}
          </span>
          <span className="text-sm font-semibold text-foreground">
            {timeRange(nextSlot.start_time, nextSlot.end_time)}
          </span>
        </div>
        <p className="mb-8 text-sm leading-5.5 font-normal text-foreground">
          {nextSlot.section_name}
          {nextSlot.staff_name ? ` · ${nextSlot.staff_name}` : ""}
        </p>
        <div className="flex gap-10 rounded-lg bg-accent/50 p-5">
          <div className="flex flex-col gap-5">
            <div className="flex items-center gap-1.5 text-sm font-normal text-foreground">
              <MapPin size={16} className="text-base text-muted-foreground" aria-hidden="true" />
              Room
            </div>
            <div className="pt-1.5 text-sm font-medium text-foreground">
              {nextSlot.room_name ?? "—"}
            </div>
          </div>
          <div className="flex flex-col gap-5">
            <div className="flex items-center gap-1.5 text-sm font-normal text-foreground">
              <Users size={16} className="text-base text-muted-foreground" aria-hidden="true" />
              Section
            </div>
            <div className="pt-1.5 text-sm font-medium text-foreground">
              {nextSlot.section_name}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
