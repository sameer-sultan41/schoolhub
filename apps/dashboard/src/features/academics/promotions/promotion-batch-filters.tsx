"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";

import { FilterSelect } from "@/components/filter-select";
import { useClasses } from "@/hooks/use-reference-data";
import type { AcademicSessionSummary } from "@/services";
import { PROMOTION_STATUSES } from "@/services/modules/promotions/promotions-constant";

export interface PromotionBatchFiltersProps {
  sessions: AcademicSessionSummary[] | undefined;
  /** The session a batch moves from, or `""` for every session. */
  sessionId: string;
  onSessionChange: (sessionId: string) => void;
  /** The class a batch moves, or `""` for every class. */
  classId: string;
  onClassIdChange: (classId: string) => void;
  /** A batch status, or `""` for every status. */
  status: string;
  onStatusChange: (status: string) => void;
}

/**
 * The batch list's filters: the session and class a batch moves from, and its status. The
 * values and setters come from the table's URL state. The list is not session-scoped, so the
 * session is a filter with an "All" choice, not a picker with a current session.
 */
export function PromotionBatchFilters({
  sessions,
  sessionId,
  onSessionChange,
  classId,
  onClassIdChange,
  status,
  onStatusChange,
}: PromotionBatchFiltersProps) {
  const t = useTranslations("academics");
  // Every class, active or not: a past session's batch may name one that is no longer offered.
  const classesQuery = useClasses();
  const statusOptions = useMemo(
    () => PROMOTION_STATUSES.map((value) => ({ id: value, name: t(`promotions.status.${value}`) })),
    [t],
  );

  return (
    <>
      <FilterSelect
        label={t("promotions.fields.fromSession")}
        allLabel={t("filters.all")}
        value={sessionId}
        onChange={onSessionChange}
        options={sessions ?? []}
      />
      <FilterSelect
        label={t("promotions.columns.fromClass")}
        allLabel={t("filters.all")}
        value={classId}
        onChange={onClassIdChange}
        options={classesQuery.data ?? []}
      />
      <FilterSelect
        label={t("promotions.filters.status")}
        allLabel={t("filters.all")}
        value={status}
        onChange={onStatusChange}
        options={statusOptions}
      />
    </>
  );
}
