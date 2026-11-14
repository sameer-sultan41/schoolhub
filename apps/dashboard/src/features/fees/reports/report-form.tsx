"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Alert, AlertDescription, Input } from "@schoolhub/ui";

import { DateRangeInputs } from "@/components/date-range-inputs";
import { FilterSelect } from "@/components/filter-select";
import { StudentPicker, type PickedStudent } from "@/components/student-picker";
import { enumLabel } from "@/lib/enum-label";
import type { FinanceReportFormValues, FinanceReportKindFields } from "@/services";
import {
  FINANCE_REPORT_GROUPINGS,
  FINANCE_REPORT_KINDS,
} from "@/services/modules/finance-reports/finance-reports-constant";
import { REPORT_GROUPING_LABEL_KEY, REPORT_KIND_LABEL_KEY } from "./report-labels";

type NamedOptions = readonly { id: string; name: string }[];

export interface ReportFormProps {
  values: FinanceReportFormValues;
  /** `null` while the form's kind is not one the screen knows (an old link). */
  fields: FinanceReportKindFields | null;
  /** Each picker's options, or `null` when the viewer may not read that list: no picker then. */
  campuses: NamedOptions | null;
  sessions: NamedOptions | null;
  classes: NamedOptions | null;
  /** The viewer may search students (`students.student.view`): the statement needs it. */
  canPickStudent: boolean;
  onChange: (updates: Partial<FinanceReportFormValues>) => void;
}

/**
 * The report's options: which report, its dates (a range, or one "as of" date for the aging and
 * the budget variance, or none for the statement and the grant register), the student a statement
 * is for, how the collection groups, and campus, session and class. Every value lives in the URL
 * and the report on screen follows it.
 */
export function ReportForm({
  values,
  fields,
  campuses,
  sessions,
  classes,
  canPickStudent,
  onChange,
}: ReportFormProps) {
  const t = useTranslations("fees");
  // The name is only for the chip: the URL holds the id, so a reload shows a generic chip.
  const [student, setStudent] = useState<PickedStudent | null>(null);
  const kindOptions = FINANCE_REPORT_KINDS.map((kind) => ({
    id: kind,
    name: enumLabel(t, REPORT_KIND_LABEL_KEY, kind),
  }));
  const pickedStudent =
    values.student === ""
      ? null
      : student?.id === values.student
        ? student
        : { id: values.student, name: t("reports.form.studentSelected") };

  return (
    <form
      aria-label={t("reports.form.label")}
      className="flex flex-wrap items-end gap-2.5"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
      }}
    >
      <FilterSelect
        label={t("reports.form.kind")}
        value={values.kind}
        options={kindOptions}
        onChange={(kind) => {
          onChange({ kind });
        }}
      />
      {fields?.dates === "range" && (
        <DateRangeInputs
          from={values.from}
          to={values.to}
          fromLabel={t("reports.form.from")}
          toLabel={t("reports.form.to")}
          onChange={onChange}
        />
      )}
      {fields?.dates === "asOf" && (
        <Input
          type="date"
          className="w-full sm:w-40"
          aria-label={t("reports.form.asOf")}
          value={values.to}
          onChange={(event) => {
            onChange({ to: event.target.value });
          }}
        />
      )}
      {fields?.groupBy && (
        <FilterSelect
          label={t("reports.form.grouping")}
          value={values.group}
          options={FINANCE_REPORT_GROUPINGS.map((grouping) => ({
            id: grouping,
            name: enumLabel(t, REPORT_GROUPING_LABEL_KEY, grouping),
          }))}
          onChange={(group) => {
            onChange({ group });
          }}
        />
      )}
      {fields?.campus && campuses !== null && (
        <FilterSelect
          label={t("reports.form.campus")}
          allLabel={t("reports.form.allCampuses")}
          value={values.campus}
          options={campuses}
          onChange={(campus) => {
            onChange({ campus });
          }}
        />
      )}
      {fields?.session && sessions !== null && (
        <FilterSelect
          label={t("reports.form.session")}
          allLabel={t("reports.form.allSessions")}
          value={values.session}
          options={sessions}
          onChange={(session) => {
            onChange({ session });
          }}
        />
      )}
      {fields?.class && classes !== null && (
        <FilterSelect
          label={t("reports.form.class")}
          allLabel={t("reports.form.allClasses")}
          value={values.class}
          options={classes}
          onChange={(classId) => {
            onChange({ class: classId });
          }}
        />
      )}
      {fields?.student &&
        (canPickStudent ? (
          <StudentPicker
            value={pickedStudent}
            onChange={(picked) => {
              setStudent(picked);
              onChange({ student: picked?.id ?? "" });
            }}
          />
        ) : (
          <Alert variant="warning" className="w-full">
            <AlertDescription>{t("reports.form.studentRestricted")}</AlertDescription>
          </Alert>
        ))}
    </form>
  );
}
