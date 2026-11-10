"use client";

import { useMemo } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { ColumnDef } from "@tanstack/react-table";

import { reportColumn as column } from "@/components/reports/report-column";
import { ResultOutcomeBadge, ResultStatusBadge } from "@/features/exams/results/result-badges";
import { EMPTY_VALUE } from "@/lib/constants";
import { formatDate } from "@/lib/helpers";
import type { ExamReportKind, ExamReportRowOf } from "@/services";
import { formatExamFigure } from "@/services/modules/exam-reports/exam-reports-helper";

/** Each kind's columns, typed on that kind's row. */
export type ExamReportColumns = { [K in ExamReportKind]: ColumnDef<ExamReportRowOf<K>>[] };

/**
 * The report table's columns for every kind, each list typed on its kind's row, so a cell reads
 * only the fields its report sends. Every figure is the server's, formatted for the locale; a
 * null one (nothing counted, or the ungraded band) is a dash. Built once per locale.
 */
export function useExamReportColumns(): ExamReportColumns {
  const t = useTranslations("exams");
  const locale = useLocale();

  return useMemo<ExamReportColumns>(() => {
    type Register = ExamReportRowOf<"result-register">;
    type PassFail = ExamReportRowOf<"pass-fail-analysis">;
    type Subject = ExamReportRowOf<"subject-performance">;
    type Entry = ExamReportRowOf<"marks-entry-status">;
    type Band = ExamReportRowOf<"grade-distribution">;
    type Bank = ExamReportRowOf<"question-bank-usage">;

    const figure = (value: number | null) =>
      value === null ? EMPTY_VALUE : formatExamFigure(value, locale);
    const percent = (value: number | null) =>
      value === null
        ? EMPTY_VALUE
        : t("reports.percent", { value: formatExamFigure(value, locale) });
    const count = (value: number | null) => value?.toLocaleString(locale) ?? EMPTY_VALUE;
    const title = (key: string) => t(`reports.columns.${key}`);

    return {
      "result-register": [
        column<Register>("rank", title("rank"), (row) => count(row.rank_in_section)),
        column<Register>("student", title("student"), (row) => (
          <span className="block">
            <span className="block">
              {t("reports.fullName", { first: row.first_name, last: row.last_name })}
            </span>
            <span className="block text-xs text-muted-foreground">{row.admission_number}</span>
          </span>
        )),
        column<Register>("section", title("section"), (row) => row.section_name),
        column<Register>("percentage", title("percentage"), (row) => percent(row.percentage)),
        column<Register>("marks", title("marks"), (row) =>
          t("reports.marksOutOf", {
            obtained: figure(row.total_obtained_marks),
            max: figure(row.total_max_marks),
          }),
        ),
        column<Register>("grade", title("grade"), (row) => row.grade ?? EMPTY_VALUE),
        column<Register>("gpa", title("gpa"), (row) => figure(row.gpa)),
        column<Register>("classRank", title("classRank"), (row) => count(row.rank_in_class)),
        column<Register>("outcome", title("outcome"), (row) => (
          <ResultOutcomeBadge outcome={row.outcome} />
        )),
        column<Register>("status", title("status"), (row) => (
          <ResultStatusBadge status={row.status} />
        )),
      ],
      "pass-fail-analysis": [
        column<PassFail>("section", title("section"), (row) => row.section_name),
        column<PassFail>("students", title("students"), (row) => count(row.students)),
        column<PassFail>("sat", title("sat"), (row) => count(row.sat)),
        column<PassFail>("passed", title("passed"), (row) => count(row.passed)),
        column<PassFail>("failed", title("failed"), (row) => count(row.failed)),
        column<PassFail>("absent", title("absent"), (row) => count(row.absent)),
        column<PassFail>("withheld", title("withheld"), (row) => count(row.withheld)),
        column<PassFail>("average", title("average"), (row) => percent(row.average_percentage)),
        column<PassFail>("highest", title("highest"), (row) => percent(row.highest_percentage)),
        column<PassFail>("lowest", title("lowest"), (row) => percent(row.lowest_percentage)),
        column<PassFail>("passRate", title("passRate"), (row) => percent(row.pass_rate)),
      ],
      "subject-performance": [
        column<Subject>("subject", title("subject"), (row) => row.subject_name),
        column<Subject>("class", title("class"), (row) => row.class_name),
        column<Subject>("maxMarks", title("maxMarks"), (row) => figure(row.max_marks)),
        column<Subject>("passMarks", title("passMarks"), (row) => figure(row.pass_marks)),
        column<Subject>("students", title("students"), (row) => count(row.students)),
        column<Subject>("average", title("average"), (row) => figure(row.average_marks)),
        column<Subject>("highest", title("highest"), (row) => figure(row.highest_marks)),
        column<Subject>("lowest", title("lowest"), (row) => figure(row.lowest_marks)),
        column<Subject>("passed", title("passed"), (row) => count(row.passed)),
        column<Subject>("passRate", title("passRate"), (row) => percent(row.pass_rate)),
      ],
      "marks-entry-status": [
        column<Entry>("subject", title("subject"), (row) => row.subject_name),
        column<Entry>("class", title("class"), (row) => row.class_name),
        column<Entry>("entered", title("entered"), (row) => count(row.entered)),
        column<Entry>("draft", title("draft"), (row) => count(row.draft)),
        column<Entry>("submitted", title("submitted"), (row) => count(row.submitted)),
        column<Entry>("locked", title("locked"), (row) => count(row.locked)),
        column<Entry>("absent", title("absent"), (row) => count(row.absent)),
        column<Entry>("exempt", title("exempt"), (row) => count(row.exempt)),
        column<Entry>("lockedAt", title("lockedAt"), (row) =>
          row.locked_at === null ? EMPTY_VALUE : formatDate(row.locked_at, locale),
        ),
      ],
      "grade-distribution": [
        column<Band>("grade", title("grade"), (row) => row.grade ?? t("reports.ungraded")),
        column<Band>("range", title("range"), (row) =>
          row.min_percent === null || row.max_percent === null
            ? EMPTY_VALUE
            : t("reports.bandRange", {
                min: formatExamFigure(row.min_percent, locale),
                max: formatExamFigure(row.max_percent, locale),
              }),
        ),
        column<Band>("passing", title("passing"), (row) =>
          row.is_passing === null
            ? EMPTY_VALUE
            : t(row.is_passing ? "reports.passing.yes" : "reports.passing.no"),
        ),
        column<Band>("students", title("students"), (row) => count(row.students)),
      ],
      "question-bank-usage": [
        column<Bank>("bank", title("bank"), (row) => row.bank_name),
        column<Bank>("subject", title("subject"), (row) => row.subject_name),
        column<Bank>("difficulty", title("difficulty"), (row) =>
          t(`reports.difficulty.${row.difficulty}`),
        ),
        column<Bank>("questions", title("questions"), (row) => count(row.questions)),
        column<Bank>("approved", title("approved"), (row) => count(row.approved)),
        column<Bank>("totalUses", title("totalUses"), (row) => count(row.total_uses)),
        column<Bank>("averageUses", title("averageUses"), (row) => figure(row.average_uses)),
      ],
    };
  }, [t, locale]);
}
