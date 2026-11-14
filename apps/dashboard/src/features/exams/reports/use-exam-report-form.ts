"use client";

import { useDataGridUrlState } from "@/hooks/use-data-grid-url-state";
import { useUrlParams } from "@/hooks/use-url-params";
import type { ExamReportKind } from "@/services";
import {
  EXAM_REPORT_DEFAULT_SORTING,
  EXAM_REPORT_HIDEABLE_IDS,
  EXAM_REPORT_KINDS,
  EXAM_REPORT_NEEDS_EXAM,
  EXAM_REPORT_SORTABLE_IDS,
  EXAM_REPORT_URL_FILTERS,
  EXAM_REPORT_URL_KEYS,
  NO_EXAM_FALLBACK_KIND,
  NO_EXAM_KINDS,
} from "@/services/modules/exam-reports/exam-reports-constant";
import { toExamReportQuery } from "@/services/modules/exam-reports/exam-reports-helper";

/**
 * The exam report form's state, all of it in the URL (`useDataGridUrlState`, which also keeps the
 * table's page), as attendance's `useReportForm` keeps its own: the kinds offered, the values in
 * effect, whether the kind takes an exam, and the report the form describes (`draft`, `null`
 * while it can't run). Without `canPickExam` (no `exams.exam.view`, so no `/exams` to pick from)
 * only the kinds about no exam are offered, and a kind the URL names outside them stands in as
 * the fallback and does not run on arrival.
 */
export function useExamReportForm({ canPickExam }: { canPickExam: boolean }) {
  const { searchParams, setParams } = useUrlParams();
  const { filters, setFilters, pagination, onPaginationChange, setPageIndex } = useDataGridUrlState(
    {
      filters: EXAM_REPORT_URL_FILTERS,
      sortableIds: EXAM_REPORT_SORTABLE_IDS,
      defaultSorting: EXAM_REPORT_DEFAULT_SORTING,
      hideableIds: EXAM_REPORT_HIDEABLE_IDS,
      trimSearch: false,
    },
  );

  const kinds: readonly ExamReportKind[] = canPickExam ? EXAM_REPORT_KINDS : NO_EXAM_KINDS;
  const offered = kinds.find((kind) => kind === filters.kind);
  const kind = offered ?? NO_EXAM_FALLBACK_KIND;
  const values = { ...filters, kind };

  // `setFilters` leaves out a value equal to its default, so the kind is written here: a link
  // copied after a run then names its report and runs on arrival.
  function writeKind() {
    setParams({ [EXAM_REPORT_URL_KEYS.kind]: kind });
  }

  return {
    kinds,
    values,
    /** The exam picker shows: every kind but question-bank usage is about one exam. */
    showExam: EXAM_REPORT_NEEDS_EXAM[kind],
    draft: toExamReportQuery(values),
    /** A shared link names a report this viewer is offered: it runs on arrival, not on Run. */
    linksToReport: offered !== undefined && searchParams.get(EXAM_REPORT_URL_KEYS.kind) === offered,
    setFilters,
    writeKind,
    pagination,
    onPaginationChange,
    setPageIndex,
  };
}
