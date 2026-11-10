"use client";

import type { SubmitEvent } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@schoolhub/ui";

import { FilterSelect } from "@/components/filter-select";
import type { ExamReportFormValues, ExamReportKind } from "@/services";

export interface ExamReportFormProps {
  /** The kinds offered, in order: all six, or only those about no exam without exam access. */
  kinds: readonly ExamReportKind[];
  values: ExamReportFormValues;
  /** The exams to pick from, newest first. */
  exams: readonly { id: string; name: string }[];
  /** Whether to offer the exam picker: every kind but question-bank usage is about one exam. */
  showExam: boolean;
  /** The report can't run as filled in (no exam picked for a kind about one). */
  canRun: boolean;
  isRunning: boolean;
  onChange: (updates: Partial<ExamReportFormValues>) => void;
  onRun: () => void;
}

/**
 * The report's options: which of the six reports, and the exam it is about (hidden for
 * question-bank usage, which is about the school's banks). Both live in the URL; Run report runs
 * what the form says.
 */
export function ExamReportForm({
  kinds,
  values,
  exams,
  showExam,
  canRun,
  isRunning,
  onChange,
  onRun,
}: ExamReportFormProps) {
  const t = useTranslations("exams");
  const kindOptions = kinds.map((kind) => ({ id: kind, name: t(`reports.kinds.${kind}`) }));

  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (canRun) onRun();
  }

  return (
    <form
      aria-label={t("reports.form.label")}
      className="flex flex-wrap items-end gap-2.5"
      onSubmit={handleSubmit}
      noValidate
    >
      <FilterSelect
        label={t("reports.form.kind")}
        value={values.kind}
        options={kindOptions}
        onChange={(kind) => {
          onChange({ kind });
        }}
      />
      {showExam && (
        <FilterSelect
          label={t("reports.form.exam")}
          value={values.exam}
          options={exams}
          onChange={(exam) => {
            onChange({ exam });
          }}
        />
      )}
      <Button type="submit" variant="primary" disabled={!canRun || isRunning}>
        {isRunning ? t("reports.form.running") : t("reports.form.run")}
      </Button>
    </form>
  );
}
