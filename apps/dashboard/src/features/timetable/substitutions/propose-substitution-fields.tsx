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
  Input,
  Textarea,
} from "@schoolhub/ui";

import { FormSelectField } from "@/components/form-select-field";
import { useActiveRooms } from "@/features/timetable/use-active-rooms";
import { useTeachingStaffOptions } from "@/hooks/use-reference-data";
import { isIsoDate, isUuid } from "@/lib/helpers";
import { queryKeys } from "@/lib/query-client";
import { Services } from "@/services";
import {
  SUBSTITUTION_CANDIDATES_RESOURCE,
  SUBSTITUTION_KEEP_ROOM,
  SUBSTITUTION_REASON_MAX,
  SUBSTITUTIONS_QUERY_MODULE,
} from "@/services/modules/teacher-substitutions/teacher-substitutions-constant";
import { weekdayOfIsoDate } from "@/services/modules/teacher-substitutions/teacher-substitutions-helper";
import type { ProposeFormValues } from "@/services/modules/teacher-substitutions/teacher-substitutions.schema";
import {
  TEACHER_CLASSES_RESOURCE,
  TIMETABLE_SLOTS_QUERY_MODULE,
} from "@/services/modules/timetable-slots/timetable-slots-constant";

export interface ProposeSubstitutionFieldsProps {
  form: UseFormReturn<ProposeFormValues>;
  academicSessionId: string;
}

/**
 * The propose form's chain: a date, then the absent teacher, then one of their published
 * classes that weekday, then a colleague free in that period (`candidates`, which already
 * leaves out anyone teaching, covering, at another campus, on leave or marked absent), then
 * an optional room move and reason. Changing an earlier pick clears the later ones, so the
 * form never sends a class the teacher doesn't have that day or a colleague who isn't free.
 */
export function ProposeSubstitutionFields({
  form,
  academicSessionId,
}: ProposeSubstitutionFieldsProps) {
  const t = useTranslations("timetable");
  const tCommon = useTranslations("common");
  const [date, absentId, slotId] = useWatch({
    control: form.control,
    name: ["date", "absent_staff_id", "timetable_slot_id"],
  });
  const validDate = isIsoDate(date);
  const weekday = validDate ? weekdayOfIsoDate(date) : -1;

  const teachersQuery = useTeachingStaffOptions();
  const classesQuery = useQuery({
    queryKey: queryKeys.list(TIMETABLE_SLOTS_QUERY_MODULE, TEACHER_CLASSES_RESOURCE, {
      academicSessionId,
      absentId,
      weekday,
    }),
    queryFn: () =>
      Services.timetableSlots.fetchTeacherClassesOn(academicSessionId, absentId, weekday),
    enabled: validDate && isUuid(absentId) && academicSessionId !== "",
  });
  const candidatesQuery = useQuery({
    queryKey: queryKeys.list(SUBSTITUTIONS_QUERY_MODULE, SUBSTITUTION_CANDIDATES_RESOURCE, {
      slotId,
      date,
    }),
    queryFn: () => Services.teacherSubstitutions.fetchCandidates(slotId, date),
    enabled: validDate && isUuid(slotId),
  });
  const slot = classesQuery.data?.find((candidate) => candidate.id === slotId);
  const roomsQuery = useActiveRooms(slot?.campus_id ?? "");

  const clear = (...names: (keyof ProposeFormValues)[]) => {
    for (const name of names) form.setValue(name, "");
  };
  const classOptions = (classesQuery.data ?? []).map((candidate) => ({
    id: candidate.id,
    name: t("substitutions.form.classOption", {
      period: candidate.period_name,
      section: candidate.section_name,
      subject: candidate.subject_name ?? t("grid.noSubject"),
    }),
  }));
  const candidateOptions = (candidatesQuery.data ?? []).map((candidate) => ({
    id: candidate.staff_id,
    name: candidate.staff_name,
  }));
  const roomOptions = (roomsQuery.data ?? []).map((room) => ({
    id: room.id,
    name: `${room.code} · ${room.name}`,
  }));
  const classPlaceholder = !isUuid(absentId)
    ? t("fields.selectTeacher")
    : classesQuery.isPending
      ? tCommon("loading")
      : classOptions.length === 0
        ? t("substitutions.form.noClasses")
        : t("substitutions.form.selectClass");
  const coverPlaceholder = !isUuid(slotId)
    ? t("substitutions.form.pickClassFirst")
    : candidatesQuery.isPending
      ? tCommon("loading")
      : candidateOptions.length === 0
        ? t("substitutions.form.noCandidates")
        : t("fields.selectTeacher");

  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField
          control={form.control}
          name="date"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("fields.date")}</FormLabel>
              <FormControl>
                <Input
                  type="date"
                  {...field}
                  onChange={(event) => {
                    field.onChange(event);
                    clear("timetable_slot_id", "substitute_staff_id", "room_id");
                  }}
                />
              </FormControl>
              <FormDescription>{t("substitutions.form.dateHint")}</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormSelectField
          form={form}
          name="absent_staff_id"
          label={t("fields.absentTeacher")}
          placeholder={teachersQuery.isPending ? tCommon("loading") : t("fields.selectTeacher")}
          options={teachersQuery.data ?? []}
          onPick={() => {
            clear("timetable_slot_id", "substitute_staff_id", "room_id");
          }}
        />
      </div>
      <FormSelectField
        form={form}
        name="timetable_slot_id"
        label={t("substitutions.form.classLabel")}
        placeholder={classPlaceholder}
        options={classOptions}
        disabled={!validDate || !isUuid(absentId)}
        onPick={() => {
          clear("substitute_staff_id", "room_id");
        }}
      />
      <FormSelectField
        form={form}
        name="substitute_staff_id"
        label={t("fields.substituteTeacher")}
        placeholder={coverPlaceholder}
        options={candidateOptions}
        disabled={!isUuid(slotId)}
        description={t("substitutions.form.substituteHint")}
      />
      <FormSelectField
        form={form}
        name="room_id"
        label={t("fields.room")}
        placeholder={t("substitutions.form.keepRoom")}
        options={roomOptions}
        emptyOption={{ value: SUBSTITUTION_KEEP_ROOM, label: t("substitutions.form.keepRoom") }}
        disabled={!slot}
        description={t("substitutions.form.roomHint")}
      />
      <FormField
        control={form.control}
        name="reason"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t("fields.reason")}</FormLabel>
            <FormControl>
              <Textarea maxLength={SUBSTITUTION_REASON_MAX} {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
    </>
  );
}
