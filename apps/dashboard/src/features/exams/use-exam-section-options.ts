"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";

import { useCurrentUser } from "@/hooks/use-current-user";
import { hasPermission } from "@/lib/permissions";
import { sectionsOfSittings } from "@/services/modules/admit-cards/admit-cards-helper";
import { useExamSittings } from "@/features/exams/use-exam-sittings";

/** A section filter option: "Grade 5 – A". */
export interface ExamSectionOption {
  id: string;
  name: string;
}

/** The sections an exam sits in, as `{ id, name }` filter options ("Grade 5 – A"): the ones its
 * sittings name, read under the Schedule tab's key. The Results, Report cards and Admit cards
 * filters use it. `null` when the viewer lacks `exams.schedule.view`, which `/exam-schedules`
 * needs: the sittings are never read and the caller hides its section filter (L35). */
export function useExamSectionOptions(examId: string): ExamSectionOption[] | null {
  const t = useTranslations("exams");
  const { data: user } = useCurrentUser();
  const canReadSittings = hasPermission(user, "exams.schedule.view");
  const { data: sittings } = useExamSittings(examId, { enabled: canReadSittings });

  return useMemo(
    () =>
      canReadSittings
        ? sectionsOfSittings(sittings ?? []).map((section) => ({
            id: section.id,
            name: t("schedule.classSection", {
              class: section.className,
              section: section.sectionName,
            }),
          }))
        : null,
    [canReadSittings, sittings, t],
  );
}
