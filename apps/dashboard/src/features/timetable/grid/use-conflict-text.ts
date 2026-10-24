"use client";

import { useTranslations } from "next-intl";

import type { TimetableConflict } from "@/services";

/** A finding's text: translated by `type` when this app knows it, else the server's own
 * message, so a detector added server-side still says something useful. */
export function useConflictText() {
  const t = useTranslations("timetable");
  return (conflict: TimetableConflict) =>
    t.has(`conflicts.types.${conflict.type}`)
      ? t(`conflicts.types.${conflict.type}`)
      : conflict.message;
}
