"use client";

import { useCallback } from "react";
import { useLocale, useTranslations } from "next-intl";

import { formatDate } from "@/lib/helpers";
import type { LeaveRequestRecord } from "@/services";

/** A request's dates as text: one date for a single day, "{from} to {to}" for a span. Returns
 * a stable function, so a columns memo can depend on it. */
export function useLeaveDates() {
  const t = useTranslations("attendance");
  const locale = useLocale();

  return useCallback(
    ({ start_date: start, end_date: end }: Pick<LeaveRequestRecord, "start_date" | "end_date">) =>
      start === end
        ? formatDate(start, locale)
        : t("leave.dateRange", { from: formatDate(start, locale), to: formatDate(end, locale) }),
    [t, locale],
  );
}
