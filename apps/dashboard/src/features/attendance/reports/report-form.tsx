"use client";

import { useId, type SubmitEvent } from "react";
import { useTranslations } from "next-intl";
import { Button, cn, Input, Label } from "@schoolhub/ui";

import { FilterSelect } from "@/components/filter-select";
import { DateRangeInputs } from "@/features/attendance/date-range-inputs";
import { useClasses } from "@/hooks/use-reference-data";
import {
  REPORT_KIND_FIELDS,
  REPORT_KINDS,
  type REPORT_URL_KEYS,
} from "@/services/modules/attendance-reports/attendance-reports-constant";
import {
  REPORT_THRESHOLD_MAX,
  REPORT_THRESHOLD_MIN,
} from "@/services/modules/attendance-reports/attendance-reports.schema";
import { isReportKind } from "@/services/modules/attendance-reports/attendance-reports-helper";

/** The URL keys this form writes (`REPORT_URL_FILTERS`). */
export type ReportFormField = (typeof REPORT_URL_KEYS)[keyof typeof REPORT_URL_KEYS];
export type ReportFormFieldValues = Record<ReportFormField, string>;

/** The threshold input's `step`: one decimal place, as the API accepts. */
const THRESHOLD_STEP = "0.1";

export interface ReportFormProps {
  /** The values in effect: the dates with their defaults, the section only with its class, the
   * period only when listed. */
  values: ReportFormFieldValues;
  /** The picked class's sections. */
  sections: readonly { id: string; name: string }[];
  /** The picked section's lesson periods on the date (`daily-register` only). */
  periods: readonly { id: string; name: string }[];
  /** Whether to offer the period picker (`daily-register`, a section, and not daily mode). */
  showPeriod: boolean;
  /** The threshold can't be sent as typed. */
  thresholdInvalid: boolean;
  /** The report can't run as filled in (a bad threshold, a range ending before it starts). */
  canRun: boolean;
  isRunning: boolean;
  onChange: (updates: Partial<ReportFormFieldValues>) => void;
  onRun: () => void;
}

/**
 * The report's options: which report, its date (`daily-register`) or range, a class and section
 * for the student reports, a period for the daily register's one-period view, and the defaulters'
 * threshold. Every value lives in the URL; Run report runs what the form says.
 */
export function ReportForm({
  values,
  sections,
  periods,
  showPeriod,
  thresholdInvalid,
  canRun,
  isRunning,
  onChange,
  onRun,
}: ReportFormProps) {
  const t = useTranslations("attendance");
  const thresholdId = useId();
  const thresholdHintId = useId();
  const classesQuery = useClasses();
  const fields = isReportKind(values.kind) ? REPORT_KIND_FIELDS[values.kind] : null;
  const kindOptions = REPORT_KINDS.map((kind) => ({ id: kind, name: t(`reports.kinds.${kind}`) }));

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
      {fields?.singleDate ? (
        <Input
          type="date"
          className="w-full sm:w-40"
          aria-label={t("register.fields.date")}
          value={values.from}
          onChange={(event) => {
            onChange({ from: event.target.value, period: "" });
          }}
        />
      ) : (
        <DateRangeInputs
          from={values.from}
          to={values.to}
          fromLabel={t("records.filters.from")}
          toLabel={t("records.filters.to")}
          onChange={onChange}
        />
      )}
      {fields?.section && (
        <>
          <FilterSelect
            label={t("register.fields.class")}
            allLabel={t("reports.form.allClasses")}
            value={values.class}
            options={classesQuery.data ?? []}
            onChange={(value) => {
              onChange({ class: value, section: "", period: "" });
            }}
          />
          <FilterSelect
            label={t("register.fields.section")}
            allLabel={t("reports.form.allSections")}
            value={values.section}
            options={sections}
            disabled={values.class === ""}
            onChange={(value) => {
              onChange({ section: value, period: "" });
            }}
          />
        </>
      )}
      {showPeriod && (
        <FilterSelect
          label={t("register.fields.period")}
          allLabel={t("reports.form.wholeDay")}
          value={values.period}
          options={periods}
          onChange={(value) => {
            onChange({ period: value });
          }}
        />
      )}
      {fields?.threshold && (
        <div className="flex flex-col gap-1">
          <Label htmlFor={thresholdId}>{t("reports.form.threshold")}</Label>
          <Input
            id={thresholdId}
            type="number"
            inputMode="decimal"
            className="w-full sm:w-28"
            min={REPORT_THRESHOLD_MIN}
            max={REPORT_THRESHOLD_MAX}
            step={THRESHOLD_STEP}
            value={values.threshold}
            aria-invalid={thresholdInvalid}
            aria-describedby={thresholdHintId}
            onChange={(event) => {
              onChange({ threshold: event.target.value });
            }}
          />
        </div>
      )}
      <Button type="submit" variant="primary" disabled={!canRun || isRunning}>
        {isRunning ? t("reports.form.running") : t("reports.form.run")}
      </Button>
      {fields?.threshold && (
        <p
          id={thresholdHintId}
          className={cn(
            "w-full text-sm",
            thresholdInvalid ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {thresholdInvalid ? t("reports.form.thresholdInvalid") : t("reports.form.thresholdHint")}
        </p>
      )}
    </form>
  );
}
