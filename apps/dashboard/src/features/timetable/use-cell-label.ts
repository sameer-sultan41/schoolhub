"use client";

import { useTranslations } from "next-intl";

/** A cell's name, "Monday · Period 1", from the one translated pattern every place uses. */
export function useCellLabel() {
  const t = useTranslations("timetable");
  return (dayOfWeek: number, periodName: string) =>
    t("grid.cellLabel", { weekday: t(`weekdays.${dayOfWeek}`), period: periodName });
}
