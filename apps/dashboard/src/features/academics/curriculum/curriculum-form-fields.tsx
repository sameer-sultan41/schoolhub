"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useWatch, type UseFormReturn } from "react-hook-form";
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Textarea,
} from "@schoolhub/ui";

import { queryKeys } from "@/lib/query-client";
import {
  Services,
  type AcademicSessionSummary,
  type CurriculumRecord,
  type SchoolOrganizationOption,
} from "@/services";
import {
  CURRICULUM_ALL_CAMPUSES,
  CURRICULUM_ELECTIVE_GROUP_FIELD,
  CURRICULUM_ELECTIVE_GROUP_MAX,
  CURRICULUM_MIN_WEEKLY_PERIODS,
  CURRICULUM_NOTES_MAX,
} from "@/services/modules/curriculum/curriculum-constant";
import type { CurriculumFormValues } from "@/services/modules/curriculum/curriculum.schema";
import { LOCKED_SESSION_STATUSES } from "@/services/modules/school-organization/school-organization-constant";

type SelectFieldName = "academic_session_id" | "class_id" | "subject_id" | "campus_id";

interface SelectFieldProps {
  form: UseFormReturn<CurriculumFormValues>;
  name: SelectFieldName;
  label: string;
  placeholder: string;
  options: readonly SchoolOrganizationOption[];
  /** An option standing in for the empty value (`""`), as a `SelectItem` can't be `""`. */
  emptyLabel?: string;
  disabled: boolean;
}

/** The `Select` value for a form value: an empty one is the empty option, when there is one. */
function selectValue(value: string, hasEmptyOption: boolean): string {
  return value === "" && hasEmptyOption ? CURRICULUM_ALL_CAMPUSES : value;
}

/** One of the four identity selects: session, class, subject and campus. */
function SelectField({
  form,
  name,
  label,
  placeholder,
  options,
  emptyLabel,
  disabled,
}: SelectFieldProps) {
  return (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <Select
            value={selectValue(field.value, emptyLabel !== undefined)}
            onValueChange={(value) => {
              field.onChange(value === CURRICULUM_ALL_CAMPUSES ? "" : value);
            }}
            disabled={disabled}
          >
            <FormControl>
              <SelectTrigger>
                <SelectValue placeholder={placeholder} />
              </SelectTrigger>
            </FormControl>
            <SelectContent>
              {emptyLabel !== undefined && (
                <SelectItem value={CURRICULUM_ALL_CAMPUSES}>{emptyLabel}</SelectItem>
              )}
              {options.map((option) => (
                <SelectItem key={option.id} value={option.id}>
                  {option.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

export interface CurriculumFormFieldsProps {
  form: UseFormReturn<CurriculumFormValues>;
  /** Set when editing: the four identity selects then show this mapping's own values, read-only. */
  record?: CurriculumRecord;
  /** The sessions a new mapping can be added to; ignored when editing. */
  sessions: AcademicSessionSummary[];
}

/**
 * The curriculum form's inputs. Creating offers live options only: active classes and
 * subjects, and sessions that are not locked. Editing never changes the session, class,
 * subject or campus (they identify the mapping), so it fetches no lists and its selects hold
 * the one value the mapping already has.
 */
export function CurriculumFormFields({ form, record, sessions }: CurriculumFormFieldsProps) {
  const t = useTranslations("academics");
  const tCommon = useTranslations("common");
  const isEdit = record !== undefined;
  const isElective = useWatch({ control: form.control, name: "is_elective" });

  const classesQuery = useQuery({
    queryKey: queryKeys.list("school-organization", "classes", { isActive: true }),
    queryFn: () => Services.schoolOrganization.fetchClasses({ isActive: true }),
    enabled: !isEdit,
  });
  const subjectsQuery = useQuery({
    queryKey: queryKeys.list("school-organization", "subjects", { isActive: true }),
    queryFn: () => Services.schoolOrganization.fetchSubjects({ isActive: true }),
    enabled: !isEdit,
  });
  const campusesQuery = useQuery({
    queryKey: queryKeys.list("school-organization", "campuses"),
    queryFn: () => Services.dashboard.fetchCampuses(),
    enabled: !isEdit,
  });

  const sessionOptions = record
    ? [{ id: record.academic_session_id, name: record.academic_session_name }]
    : sessions.filter((session) => !LOCKED_SESSION_STATUSES.includes(session.status));
  const classOptions = record
    ? [{ id: record.class_id, name: record.class_name }]
    : (classesQuery.data ?? []);
  const subjectOptions = record
    ? [{ id: record.subject_id, name: record.subject_name }]
    : (subjectsQuery.data ?? []);
  // A null campus means "all campuses", which the select's empty option already covers.
  const campusOptions = record
    ? record.campus_id
      ? [{ id: record.campus_id, name: record.campus_name ?? "" }]
      : []
    : (campusesQuery.data ?? []);

  return (
    <>
      <SelectField
        form={form}
        name="academic_session_id"
        label={t("fields.academicSession")}
        placeholder={t("fields.selectSession")}
        options={sessionOptions}
        disabled={isEdit}
      />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <SelectField
          form={form}
          name="class_id"
          label={t("fields.class")}
          placeholder={classesQuery.isPending ? tCommon("loading") : t("fields.selectClass")}
          options={classOptions}
          disabled={isEdit}
        />
        <SelectField
          form={form}
          name="subject_id"
          label={t("fields.subject")}
          placeholder={subjectsQuery.isPending ? tCommon("loading") : t("fields.selectSubject")}
          options={subjectOptions}
          disabled={isEdit}
        />
        <SelectField
          form={form}
          name="campus_id"
          label={t("fields.campus")}
          placeholder={t("fields.allCampuses")}
          options={campusOptions}
          emptyLabel={t("fields.allCampuses")}
          disabled={isEdit}
        />
        <FormField
          control={form.control}
          name="weekly_periods"
          render={({ field: { onChange, value, ...field } }) => (
            <FormItem>
              <FormLabel>{t("fields.weeklyPeriods")}</FormLabel>
              <FormControl>
                <Input
                  type="number"
                  inputMode="numeric"
                  min={CURRICULUM_MIN_WEEKLY_PERIODS}
                  {...field}
                  // Cleared, `valueAsNumber` is NaN: shown as empty, and zod rejects it.
                  value={Number.isNaN(value) ? "" : value}
                  onChange={(event) => {
                    onChange(event.target.valueAsNumber);
                  }}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>
      <FormField
        control={form.control}
        name="is_elective"
        render={({ field }) => (
          <FormItem>
            <div className="flex items-center justify-between gap-3">
              <FormLabel>{t("fields.isElective")}</FormLabel>
              <FormControl>
                <Switch checked={field.value} onCheckedChange={field.onChange} />
              </FormControl>
            </div>
            <FormMessage />
          </FormItem>
        )}
      />
      {isElective && (
        <FormField
          control={form.control}
          name={CURRICULUM_ELECTIVE_GROUP_FIELD}
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("fields.electiveGroup")}</FormLabel>
              <FormControl>
                <Input maxLength={CURRICULUM_ELECTIVE_GROUP_MAX} {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      )}
      <FormField
        control={form.control}
        name="notes"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t("fields.notes")}</FormLabel>
            <FormControl>
              <Textarea maxLength={CURRICULUM_NOTES_MAX} {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
    </>
  );
}
