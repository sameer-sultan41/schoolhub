"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useWatch, type UseFormReturn } from "react-hook-form";
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Textarea,
} from "@schoolhub/ui";

import { FormSelectField } from "@/components/form-select-field";
import { useActiveRooms } from "@/features/timetable/use-active-rooms";
import { useClassSubjectOptions } from "@/hooks/use-class-subject-options";
import { useTeachingStaffOptions } from "@/hooks/use-reference-data";
import { queryKeys } from "@/lib/query-client";
import { Services } from "@/services";
import {
  ALLOCATION_QUERY_MODULE,
  ALLOCATION_SECTION_RESOURCE,
} from "@/services/modules/teacher-allocations/teacher-allocations-constant";
import {
  SLOT_NONE,
  SLOT_NOTES_MAX,
} from "@/services/modules/timetable-slots/timetable-slots-constant";
import { orderTeachersByAllocation } from "@/services/modules/timetable-slots/timetable-slots-helper";
import type { SlotFormValues } from "@/services/modules/timetable-slots/timetable-slots.schema";

export interface SlotFormFieldsProps {
  form: UseFormReturn<SlotFormValues>;
  academicSessionId: string;
  classId: string;
  sectionId: string;
  campusId: string;
}

/**
 * The cell's picks: a subject from the class's curriculum, a teacher (every teaching staff
 * member, those allocated to this section and subject first), a room in service at the
 * section's campus, and a note. Each may be "None": a homeroom or assembly period.
 */
export function SlotFormFields({
  form,
  academicSessionId,
  classId,
  sectionId,
  campusId,
}: SlotFormFieldsProps) {
  const t = useTranslations("timetable");
  const tCommon = useTranslations("common");
  const subjectId = useWatch({ control: form.control, name: "subject_id" });

  const subjectsQuery = useClassSubjectOptions(academicSessionId, classId);
  const teachersQuery = useTeachingStaffOptions();
  const allocationsQuery = useQuery({
    queryKey: queryKeys.list(ALLOCATION_QUERY_MODULE, ALLOCATION_SECTION_RESOURCE, {
      academicSessionId,
      sectionId,
    }),
    queryFn: () =>
      Services.teacherAllocations.fetchSectionAllocations(academicSessionId, sectionId),
  });
  const roomsQuery = useActiveRooms(campusId);

  const teacherOptions = orderTeachersByAllocation(
    teachersQuery.data ?? [],
    allocationsQuery.data ?? [],
    subjectId,
  ).map((teacher) => ({
    id: teacher.id,
    name: teacher.allocated ? t("slot.form.allocated", { name: teacher.name }) : teacher.name,
  }));
  const roomOptions = (roomsQuery.data ?? []).map((room) => ({
    id: room.id,
    name: `${room.code} · ${room.name}`,
  }));
  const none = { value: SLOT_NONE, label: t("fields.none") };

  return (
    <>
      <FormSelectField
        form={form}
        name="subject_id"
        label={t("fields.subject")}
        placeholder={subjectsQuery.isPending ? tCommon("loading") : t("fields.selectSubject")}
        options={subjectsQuery.data ?? []}
        emptyOption={none}
        description={t("slot.form.subjectHint")}
      />
      <FormSelectField
        form={form}
        name="staff_id"
        label={t("fields.teacher")}
        placeholder={teachersQuery.isPending ? tCommon("loading") : t("fields.selectTeacher")}
        options={teacherOptions}
        emptyOption={none}
        description={t("slot.form.allocationHint")}
      />
      <FormSelectField
        form={form}
        name="room_id"
        label={t("fields.room")}
        placeholder={roomsQuery.isPending ? tCommon("loading") : t("fields.selectRoom")}
        options={roomOptions}
        emptyOption={none}
      />
      <FormField
        control={form.control}
        name="notes"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t("fields.notes")}</FormLabel>
            <FormControl>
              <Textarea maxLength={SLOT_NOTES_MAX} {...field} />
            </FormControl>
            <FormDescription>{t("slot.form.notesHint")}</FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />
    </>
  );
}
