"use client";

import { useTranslations } from "next-intl";

import { SessionPicker } from "@/components/academic-session/session-picker";
import { FilterSelect } from "@/components/filter-select";
import { useClasses } from "@/hooks/use-reference-data";
import type { WeekGridState } from "./use-week-grid";

/** Which section's week the grid shows: the session, then the class, then its section. All
 * three live in the URL, so a reload keeps the grid and a link shares it. */
export function GridPickers({ grid }: { grid: WeekGridState }) {
  const t = useTranslations("timetable");
  const classesQuery = useClasses();

  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <SessionPicker
        sessions={grid.sessions}
        value={grid.session?.id ?? ""}
        onChange={(sessionId) => {
          grid.pick("session", sessionId);
        }}
        className="w-full sm:w-44"
      />
      <FilterSelect
        label={t("fields.class")}
        value={grid.classId}
        options={classesQuery.data ?? []}
        onChange={(classId) => {
          grid.pick("class", classId);
        }}
      />
      <FilterSelect
        label={t("fields.section")}
        value={grid.sectionId}
        options={grid.sections ?? []}
        disabled={grid.classId === ""}
        onChange={(sectionId) => {
          grid.pick("section", sectionId);
        }}
      />
    </div>
  );
}
