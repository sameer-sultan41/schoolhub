"use client";

import { useTranslations } from "next-intl";
import { useFormContext, useWatch, type UseFormReturn } from "react-hook-form";
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  Switch,
} from "@schoolhub/ui";

import { FormSelectField } from "@/components/form-select-field";
import { useClasses, useSections } from "@/hooks/use-reference-data";
import type { TeacherAllocationRecord } from "@/services";
import { ALLOCATION_MIN_WEEKLY_PERIODS } from "@/services/modules/teacher-allocations/teacher-allocations-constant";
import type {
  AllocationEditFormValues,
  AllocationFormValues,
} from "@/services/modules/teacher-allocations/teacher-allocations.schema";
import { useClassSubjectOptions } from "./use-class-subject-options";
import { useTeachingStaffOptions } from "./use-teaching-staff-options";

export interface AllocationIdentityFieldsProps {
  form: UseFormReturn<AllocationFormValues>;
  /** The session the allocation is made in: its curriculum decides which subjects are valid. */
  sessionId: string;
}

/** Class, its active sections, its curriculum subjects, then a teacher; a new class clears two. */
export function AllocationIdentityFields({ form, sessionId }: AllocationIdentityFieldsProps) {
  const t = useTranslations("academics");
  const tCommon = useTranslations("common");
  const classId = useWatch({ control: form.control, name: "class_id" });
  const hasClass = classId !== "";

  const classesQuery = useClasses({ isActive: true });
  const sectionsQuery = useSections(classId, { isActive: true });
  const subjectsQuery = useClassSubjectOptions(sessionId, classId);
  const teachersQuery = useTeachingStaffOptions();

  const hasNoCurriculum = subjectsQuery.isSuccess && subjectsQuery.data.length === 0;

  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormSelectField
          form={form}
          name="class_id"
          label={t("fields.class")}
          placeholder={classesQuery.isPending ? tCommon("loading") : t("fields.selectClass")}
          options={classesQuery.data ?? []}
          onPick={() => {
            form.setValue("section_id", "");
            form.setValue("subject_id", "");
          }}
        />
        <FormSelectField
          form={form}
          name="section_id"
          label={t("fields.section")}
          placeholder={
            hasClass && sectionsQuery.isPending ? tCommon("loading") : t("fields.selectSection")
          }
          options={sectionsQuery.data ?? []}
          disabled={!hasClass}
        />
      </div>
      <FormSelectField
        form={form}
        name="subject_id"
        label={t("fields.subject")}
        placeholder={
          hasClass && subjectsQuery.isPending ? tCommon("loading") : t("fields.selectSubject")
        }
        options={subjectsQuery.data ?? []}
        disabled={!hasClass}
        description={hasNoCurriculum ? t("allocations.form.noCurriculumSubjects") : undefined}
      />
      <FormSelectField
        form={form}
        name="staff_id"
        label={t("fields.teacher")}
        placeholder={teachersQuery.isPending ? tCommon("loading") : t("fields.selectTeacher")}
        options={teachersQuery.data ?? []}
        description={t("fields.teacherHint")}
      />
    </>
  );
}

export interface AllocationIdentitySummaryProps {
  record: TeacherAllocationRecord;
}

/** The section, subject and teacher an allocation is for, read-only: they identify it. */
export function AllocationIdentitySummary({ record }: AllocationIdentitySummaryProps) {
  const t = useTranslations("academics");
  const rows = [
    [
      t("fields.section"),
      t("allocations.sectionLabel", {
        className: record.class_name,
        sectionName: record.section_name,
      }),
    ],
    [t("fields.subject"), record.subject_name],
    [t("fields.teacher"), record.staff_name],
  ] as const;

  return (
    <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt className="text-xs text-muted-foreground">{label}</dt>
          <dd className="text-sm font-medium text-foreground">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * An allocation's terms, the only part an edit can change: primary or co-teacher, the
 * weekly-period override and the start date. Read from the surrounding form's context, as the
 * allocate form (which has more fields) and the edit form both render it.
 */
export function AllocationTermsFields() {
  const t = useTranslations("academics");
  const form = useFormContext<AllocationEditFormValues>();

  return (
    <>
      <FormField
        control={form.control}
        name="is_primary"
        render={({ field }) => (
          <FormItem>
            <div className="flex items-center justify-between gap-3">
              <FormLabel>{t("fields.isPrimary")}</FormLabel>
              <FormControl>
                <Switch checked={field.value} onCheckedChange={field.onChange} />
              </FormControl>
            </div>
            <FormDescription>{t("allocations.form.isPrimaryHint")}</FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField
          control={form.control}
          name="weekly_periods"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("fields.weeklyPeriods")}</FormLabel>
              <FormControl>
                <Input
                  type="number"
                  inputMode="numeric"
                  min={ALLOCATION_MIN_WEEKLY_PERIODS}
                  {...field}
                />
              </FormControl>
              <FormDescription>{t("allocations.form.weeklyPeriodsHint")}</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="effective_from"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("fields.effectiveFrom")}</FormLabel>
              <FormControl>
                <Input type="date" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>
    </>
  );
}
