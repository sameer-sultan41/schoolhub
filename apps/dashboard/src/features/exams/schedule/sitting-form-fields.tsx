"use client";

import { useTranslations } from "next-intl";
import { useWatch, type UseFormReturn } from "react-hook-form";
import { FormControl, FormField, FormItem, FormLabel, FormMessage, Input } from "@schoolhub/ui";

import { FormSelectField } from "@/components/form-select-field";
import { useSections, useTeachingStaffOptions } from "@/hooks/use-reference-data";
import { useExamSubjects } from "@/features/exams/use-exam-subjects";
import { useActiveRooms } from "@/features/timetable/use-active-rooms";
import type { SittingFormValues } from "@/services/modules/exam-schedules/exam-schedules.schema";

export interface SittingFormFieldsProps {
  form: UseFormReturn<SittingFormValues>;
  examId: string;
}

type InputFieldName = "exam_date" | "start_time" | "end_time";

function InputField({
  form,
  name,
  label,
  type,
}: {
  form: UseFormReturn<SittingFormValues>;
  name: InputFieldName;
  label: string;
  type: "date" | "time";
}) {
  return (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <Input type={type} {...field} />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

/**
 * The sitting form's inputs. The paper is one of the exam's own subjects; the section is one of
 * that subject's class (picking another paper clears it); the room is one in service on the
 * section's campus, since an exam has no campus of its own (a new section clears it too); the
 * invigilator is any active teacher. Every field renders its own `FormMessage`, so a server error
 * mapped onto it shows under it.
 */
export function SittingFormFields({ form, examId }: SittingFormFieldsProps) {
  const t = useTranslations("exams");
  const tCommon = useTranslations("common");
  const subjectId = useWatch({ control: form.control, name: "exam_subject_id" });
  const sectionId = useWatch({ control: form.control, name: "section_id" });

  const subjectsQuery = useExamSubjects(examId);
  const subject = subjectsQuery.data?.find((row) => row.id === subjectId);
  const classId = subject?.class_id ?? "";
  const sectionsQuery = useSections(classId, { isActive: true });
  const campusId = sectionsQuery.data?.find((section) => section.id === sectionId)?.campus_id ?? "";
  const roomsQuery = useActiveRooms(campusId);
  const staffQuery = useTeachingStaffOptions();

  const subjectOptions = (subjectsQuery.data ?? []).map((row) => ({
    id: row.id,
    name: t("schedule.form.subjectOption", { subject: row.subject_name, class: row.class_name }),
  }));

  return (
    <>
      <FormSelectField
        form={form}
        name="exam_subject_id"
        label={t("schedule.form.subject")}
        placeholder={
          subjectsQuery.isPending ? tCommon("loading") : t("schedule.form.selectSubject")
        }
        options={subjectOptions}
        onPick={() => {
          form.setValue("section_id", "");
          form.setValue("room_id", "");
        }}
      />
      <FormSelectField
        form={form}
        name="section_id"
        label={t("schedule.form.section")}
        placeholder={
          classId !== "" && sectionsQuery.isPending
            ? tCommon("loading")
            : t("schedule.form.selectSection")
        }
        options={sectionsQuery.data ?? []}
        disabled={classId === ""}
        onPick={() => {
          form.setValue("room_id", "");
        }}
      />
      <InputField form={form} name="exam_date" label={t("schedule.form.date")} type="date" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <InputField
          form={form}
          name="start_time"
          label={t("schedule.form.startTime")}
          type="time"
        />
        <InputField form={form} name="end_time" label={t("schedule.form.endTime")} type="time" />
      </div>
      <FormSelectField
        form={form}
        name="room_id"
        label={t("schedule.form.room")}
        placeholder={
          campusId !== "" && roomsQuery.isPending
            ? tCommon("loading")
            : t("schedule.form.selectRoom")
        }
        options={roomsQuery.data ?? []}
        disabled={campusId === ""}
        emptyOption={{ value: "none", label: t("schedule.form.noRoom") }}
        description={t("schedule.form.roomHint")}
      />
      <FormSelectField
        form={form}
        name="invigilator_staff_id"
        label={t("schedule.form.invigilator")}
        placeholder={
          staffQuery.isPending ? tCommon("loading") : t("schedule.form.selectInvigilator")
        }
        options={staffQuery.data ?? []}
        emptyOption={{ value: "none", label: t("schedule.form.noInvigilator") }}
      />
    </>
  );
}
