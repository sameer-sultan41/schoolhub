"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useWatch, type FieldValues, type Path, type UseFormReturn } from "react-hook-form";
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@schoolhub/ui";

import { queryKeys } from "@/lib/query-client";
import { Services } from "@/services";

/**
 * Shared by `EnrollDialog` (unlocked — both class and section can be picked), `ChangeSectionDialog`
 * (locked — `ChangeSectionRequestSerializer` has no `class_id`, so only the section is
 * interactive), and `CompleteTransferDialog`'s `inter_campus` branch (locked, scoped to the
 * transfer's destination campus rather than the student's current one) — the third real
 * consumer that earns this its own file rather than a speculative extraction.
 *
 * Both pickers always send `isActive: true` — the enroll/change-section/complete scoping
 * rule, distinct from the student directory's own filter pickers, which show every
 * class/section regardless of status.
 */
export interface ClassSectionFieldsProps<TFieldValues extends FieldValues> {
  form: UseFormReturn<TFieldValues>;
  campusId: string;
  locked: boolean;
  /** Required when `locked` — the class shown as a fixed label; the section picker still
   * cascades off its id. Ignored when not locked. */
  currentClass?: { id: string; name: string };
  /** Required when not `locked` — the form field driving the class `Select`. Ignored when
   * locked (there is no class field to drive). */
  classFieldName?: Path<TFieldValues>;
  sectionFieldName: Path<TFieldValues>;
}

export function ClassSectionFields<TFieldValues extends FieldValues>({
  form,
  campusId,
  locked,
  currentClass,
  classFieldName,
  sectionFieldName,
}: ClassSectionFieldsProps<TFieldValues>) {
  const t = useTranslations("students");
  const tCommon = useTranslations("common");

  // Called unconditionally regardless of `locked` (Rules of Hooks) — in locked mode
  // there's no real class field to watch, so a name guaranteed absent from any real form
  // values is passed instead; its `undefined` result is simply never read (`classId`
  // below uses `currentClass.id` in that branch).
  const watchedClassId = useWatch({
    control: form.control,
    name: classFieldName ?? ("__class_section_fields_unused__" as Path<TFieldValues>),
  }) as string | undefined;
  const classId = locked ? currentClass?.id : watchedClassId;

  const classesQuery = useQuery({
    queryKey: queryKeys.list("school-organization", "classes", { isActive: true }),
    queryFn: () => Services.schoolOrganization.fetchClasses({ isActive: true }),
    enabled: !locked,
  });

  const sectionsQuery = useQuery({
    queryKey: queryKeys.list("school-organization", "sections", {
      classId,
      campusId,
      isActive: true,
    }),
    queryFn: () =>
      Services.schoolOrganization.fetchSections({
        classId: classId as string,
        campusId,
        isActive: true,
      }),
    enabled: Boolean(classId && campusId),
  });

  return (
    <>
      {locked ? (
        <FormItem>
          <FormLabel>{t("enrollment.fields.class")}</FormLabel>
          <p className="text-sm">{currentClass?.name}</p>
        </FormItem>
      ) : (
        <FormField
          control={form.control}
          name={classFieldName as Path<TFieldValues>}
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("enrollment.fields.class")}</FormLabel>
              <Select
                value={field.value}
                onValueChange={(value) => {
                  field.onChange(value);
                  form.resetField(sectionFieldName);
                }}
              >
                <FormControl>
                  <SelectTrigger>
                    <SelectValue
                      placeholder={
                        classesQuery.isPending
                          ? tCommon("loading")
                          : t("enrollment.fields.selectClass")
                      }
                    />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {(classesQuery.data ?? []).map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />
      )}
      <FormField
        control={form.control}
        name={sectionFieldName}
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t("enrollment.fields.section")}</FormLabel>
            <Select value={field.value} onValueChange={field.onChange} disabled={!classId}>
              <FormControl>
                <SelectTrigger>
                  <SelectValue
                    placeholder={
                      sectionsQuery.isPending
                        ? tCommon("loading")
                        : t("enrollment.fields.selectSection")
                    }
                  />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                {(sectionsQuery.data ?? []).map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FormMessage />
          </FormItem>
        )}
      />
    </>
  );
}
