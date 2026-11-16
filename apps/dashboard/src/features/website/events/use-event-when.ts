"use client";

import { useCallback, useMemo } from "react";
import { useLocale, useTranslations } from "next-intl";

import { formatDate } from "@/lib/helpers";
import type { SchoolEventRecord } from "@/services";

/**
 * An event's dates as one line in the viewer's language: the day (or days) of an all-day event,
 * else its start, and its end when it has one.
 */
export function useEventWhen() {
  const t = useTranslations("website.events.when");
  const locale = useLocale();
  const dateTime = useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }),
    [locale],
  );

  return useCallback(
    (event: Pick<SchoolEventRecord, "starts_at" | "ends_at" | "is_all_day">): string => {
      if (event.is_all_day) {
        const start = formatDate(event.starts_at, locale);
        const end = event.ends_at ? formatDate(event.ends_at, locale) : start;
        return end === start ? t("allDay", { start }) : t("allDayRange", { start, end });
      }
      const start = dateTime.format(new Date(event.starts_at));
      return event.ends_at
        ? t("range", { start, end: dateTime.format(new Date(event.ends_at)) })
        : start;
    },
    [t, locale, dateTime],
  );
}
