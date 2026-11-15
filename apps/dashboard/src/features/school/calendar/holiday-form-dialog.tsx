"use client";

import { useMemo } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { FormDialogLayout } from "@/components/form-dialog-layout";
import { FormSelectField } from "@/components/form-select-field";
import { TextFormField } from "@/features/school/shared/text-form-field";
import { useStructureFormMessages } from "@/features/school/shared/use-structure-form-messages";
import { useFormDialogSubmit } from "@/hooks/use-form-dialog-submit";
import { useInvalidateModule } from "@/hooks/use-invalidate-module";
import { useCampuses } from "@/hooks/use-reference-data";
import { rekeyFieldErrors } from "@/lib/error-message";
import { Services, type HolidayEntry } from "@/services";
import {
  ALL_CAMPUSES_OPTION,
  HOLIDAY_ERROR_FIELDS,
  HOLIDAY_NAME_MAX,
  SCHOOL_ORGANIZATION_QUERY_MODULE,
} from "@/services/modules/school-organization/school-organization-constant";
import {
  buildHolidayEntry,
  defaultHolidayFormValues,
  holidayErrorField,
  holidayToFormValues,
  withHoliday,
} from "@/services/modules/school-organization/school-organization-helper";
import {
  createHolidayFormSchema,
  type HolidayFormValues,
} from "@/services/modules/school-organization/school-organization.schema";

export interface HolidayFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The stored holidays: the `PUT` replaces the whole list, this one entry changed. */
  holidays: readonly HolidayEntry[];
  /** The entry to edit, by its place in `holidays`; omitted to add one. */
  index?: number;
}

/**
 * Adds a holiday, or edits one: a name, a first day, an optional last day and an optional
 * campus (blank is every campus). The server names a refusal by the entry's place in the list
 * (`holidays.2.end_date`); that lands under this entry's own input.
 *
 * Mounting contract: the caller mounts this only while it is open, so every open is a fresh
 * form.
 */
export function HolidayFormDialog({ open, onOpenChange, holidays, index }: HolidayFormDialogProps) {
  const t = useTranslations("school");
  const tCommon = useTranslations("common");
  const invalidate = useInvalidateModule(SCHOOL_ORGANIZATION_QUERY_MODULE);
  const messages = useStructureFormMessages();
  const campusesQuery = useCampuses();

  const editing = index === undefined ? undefined : holidays[index];
  const position = index ?? holidays.length;

  const schema = useMemo(() => createHolidayFormSchema(messages), [messages]);
  const form = useForm<HolidayFormValues>({
    resolver: zodResolver(schema),
    defaultValues: editing ? holidayToFormValues(editing) : defaultHolidayFormValues(),
  });

  const { handleSubmit, formError, isPending } = useFormDialogSubmit({
    form,
    mutationFn: async (values: HolidayFormValues) => {
      try {
        return await Services.schoolOrganization.updateHolidayCalendar({
          holidays: withHoliday(holidays, position, buildHolidayEntry(values)),
        });
      } catch (error) {
        throw rekeyFieldErrors(error, holidayErrorField(position));
      }
    },
    knownFields: HOLIDAY_ERROR_FIELDS,
    onSuccess: () => {
      invalidate();
      toast.success(t("calendar.holidays.saved"));
      onOpenChange(false);
    },
    fallbackMessage: tCommon("submitFailed"),
  });

  return (
    <FormDialogLayout
      open={open}
      onOpenChange={onOpenChange}
      title={editing ? t("calendar.form.editTitle") : t("calendar.form.createTitle")}
      description={t("calendar.form.description")}
      form={form}
      onSubmit={handleSubmit}
      formError={formError}
      isPending={isPending}
      submittingLabel={tCommon("saving")}
    >
      <TextFormField
        form={form}
        name="name"
        label={t("fields.name")}
        maxLength={HOLIDAY_NAME_MAX}
      />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <TextFormField
          form={form}
          name="start_date"
          type="date"
          label={t("calendar.fields.startDate")}
        />
        <TextFormField
          form={form}
          name="end_date"
          type="date"
          label={t("calendar.fields.endDate")}
          description={t("calendar.form.endDateHint")}
        />
      </div>
      <FormSelectField
        form={form}
        name="campus_id"
        label={t("fields.campus")}
        placeholder={campusesQuery.isPending ? tCommon("loading") : t("allCampuses")}
        options={campusesQuery.data ?? []}
        emptyOption={{ value: ALL_CAMPUSES_OPTION, label: t("allCampuses") }}
      />
    </FormDialogLayout>
  );
}
