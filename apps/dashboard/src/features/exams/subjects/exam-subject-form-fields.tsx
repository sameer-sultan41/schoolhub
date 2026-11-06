"use client";

import { useTranslations } from "next-intl";
import { useWatch, type UseFormReturn } from "react-hook-form";
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
import { useClassSubjectOptions } from "@/hooks/use-class-subject-options";
import { useClasses } from "@/hooks/use-reference-data";
import type { ExamSubjectFormValues } from "@/services/modules/exam-subjects/exam-subjects.schema";

export interface ExamSubjectFormFieldsProps {
  form: UseFormReturn<ExamSubjectFormValues>;
  /** The exam's session: the class's curriculum there decides which subjects are valid. */
  sessionId: string;
  /** An existing row's class and subject identify it, so they are not picked again. */
  isEdit: boolean;
}

function DecimalField({
  form,
  name,
  label,
  hint,
}: {
  form: UseFormReturn<ExamSubjectFormValues>;
  name:
    | "max_marks"
    | "pass_marks"
    | "practical_max_marks"
    | "practical_pass_marks"
    | "subject_weightage_percent";
  label: string;
  hint?: string;
}) {
  return (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <Input inputMode="decimal" {...field} />
          </FormControl>
          {hint && <FormDescription>{hint}</FormDescription>}
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

/**
 * The subject form's inputs: class, then its curriculum subjects for the exam's session (a new
 * class clears the subject), the marks, the practical split (its maximum and pass marks show only
 * while `has_practical` is on) and the entry window. Every field renders its own `FormMessage`,
 * so a server error mapped onto it, the duplicate (exam, class, subject) one under `subject_id`
 * included, shows under it.
 */
export function ExamSubjectFormFields({ form, sessionId, isEdit }: ExamSubjectFormFieldsProps) {
  const t = useTranslations("exams");
  const tCommon = useTranslations("common");
  const classId = useWatch({ control: form.control, name: "class_id" });
  const hasPractical = useWatch({ control: form.control, name: "has_practical" });
  const hasClass = classId !== "";

  const classesQuery = useClasses({ isActive: true });
  const subjectsQuery = useClassSubjectOptions(sessionId, classId);
  const hasNoCurriculum = subjectsQuery.isSuccess && subjectsQuery.data.length === 0;

  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormSelectField
          form={form}
          name="class_id"
          label={t("subjects.form.class")}
          placeholder={classesQuery.isPending ? tCommon("loading") : t("subjects.form.selectClass")}
          options={classesQuery.data ?? []}
          disabled={isEdit}
          onPick={() => {
            form.setValue("subject_id", "");
          }}
        />
        <FormSelectField
          form={form}
          name="subject_id"
          label={t("subjects.form.subject")}
          placeholder={
            hasClass && subjectsQuery.isPending
              ? tCommon("loading")
              : t("subjects.form.selectSubject")
          }
          options={subjectsQuery.data ?? []}
          disabled={isEdit || !hasClass}
          description={hasNoCurriculum ? t("subjects.form.noCurriculum") : undefined}
        />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <DecimalField form={form} name="max_marks" label={t("subjects.form.maxMarks")} />
        <DecimalField form={form} name="pass_marks" label={t("subjects.form.passMarks")} />
      </div>
      <FormField
        control={form.control}
        name="has_practical"
        render={({ field }) => (
          <FormItem>
            <div className="flex items-center justify-between gap-3">
              <FormLabel>{t("subjects.form.hasPractical")}</FormLabel>
              <FormControl>
                <Switch checked={field.value} onCheckedChange={field.onChange} />
              </FormControl>
            </div>
            <FormMessage />
          </FormItem>
        )}
      />
      {hasPractical && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <DecimalField
            form={form}
            name="practical_max_marks"
            label={t("subjects.form.practicalMax")}
          />
          <DecimalField
            form={form}
            name="practical_pass_marks"
            label={t("subjects.form.practicalPass")}
          />
        </div>
      )}
      <DecimalField
        form={form}
        name="subject_weightage_percent"
        label={t("subjects.form.weightage")}
        hint={t("subjects.form.weightageHint")}
      />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField
          control={form.control}
          name="marks_entry_opens_at"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("subjects.form.opensAt")}</FormLabel>
              <FormControl>
                <Input type="datetime-local" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="marks_entry_closes_at"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("subjects.form.closesAt")}</FormLabel>
              <FormControl>
                <Input type="datetime-local" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>
    </>
  );
}
