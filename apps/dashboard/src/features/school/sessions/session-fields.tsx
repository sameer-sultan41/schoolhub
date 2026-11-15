"use client";

import { useTranslations } from "next-intl";
import type { UseFormReturn } from "react-hook-form";

import { TextFormField } from "@/features/school/shared/text-form-field";
import { SESSION_NAME_MAX } from "@/services/modules/school-organization/school-organization-constant";
import type { SessionFormValues } from "@/services/modules/school-organization/school-organization.schema";

/** A session's name and dates: the create, edit and clone dialogs ask for the same three. */
export function SessionFields({ form }: { form: UseFormReturn<SessionFormValues> }) {
  const t = useTranslations("school");
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <TextFormField
          form={form}
          name="name"
          label={t("fields.name")}
          maxLength={SESSION_NAME_MAX}
          placeholder={t("sessions.form.namePlaceholder")}
        />
      </div>
      <TextFormField form={form} name="start_date" type="date" label={t("fields.startDate")} />
      <TextFormField form={form} name="end_date" type="date" label={t("fields.endDate")} />
    </div>
  );
}
