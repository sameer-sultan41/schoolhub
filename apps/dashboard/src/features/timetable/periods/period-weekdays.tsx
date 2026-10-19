"use client";

import { useTranslations } from "next-intl";

/** A period's days as short names ("Mon, Wed"), or "Every working day" for none. */
export function PeriodWeekdays({ weekdays }: { weekdays: number[] | null }) {
  const t = useTranslations("timetable");

  if (weekdays === null || weekdays.length === 0) return <>{t("periods.everyWorkingDay")}</>;
  return <>{weekdays.map((day) => t(`weekdaysShort.${day}`)).join(", ")}</>;
}
