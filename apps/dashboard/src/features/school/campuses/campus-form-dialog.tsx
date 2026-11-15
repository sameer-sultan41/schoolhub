"use client";

import { useMemo } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { FormDialogLayout } from "@/components/form-dialog-layout";
import { SwitchFormField, TextFormField } from "@/features/school/shared/text-form-field";
import { useFormDialogSubmit } from "@/hooks/use-form-dialog-submit";
import { useInvalidateModule } from "@/hooks/use-invalidate-module";
import { Services, type CampusRecord } from "@/services";
import {
  CAMPUS_CODE_MAX,
  CAMPUS_EMAIL_MAX,
  CAMPUS_ERROR_FIELDS,
  CAMPUS_NAME_MAX,
  CAMPUS_PHONE_MAX,
  CAMPUS_TIMEZONE_MAX,
  SCHOOL_ORGANIZATION_QUERY_MODULE,
} from "@/services/modules/school-organization/school-organization-constant";
import {
  buildCampusInput,
  defaultCampusFormValues,
  recordToCampusFormValues,
} from "@/services/modules/school-organization/school-organization-helper";
import {
  createCampusFormSchema,
  type CampusFormValues,
} from "@/services/modules/school-organization/school-organization.schema";
import { useStructureFormMessages } from "@/features/school/shared/use-structure-form-messages";

export interface CampusFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The campus to edit; omitted to add one. */
  record?: CampusRecord;
}

/**
 * Adds a campus, or edits one. Marking it primary demotes the current primary campus (the
 * server does it in the same write). A server error that names a field shows under it; any
 * other is the form's own message.
 *
 * Mounting contract: the caller mounts this only while it is open, so every open is a fresh
 * form. An edit starts from the row the table holds, so no prefill lands after mount.
 */
export function CampusFormDialog({ open, onOpenChange, record }: CampusFormDialogProps) {
  const t = useTranslations("school");
  const tCommon = useTranslations("common");
  const invalidate = useInvalidateModule(SCHOOL_ORGANIZATION_QUERY_MODULE);
  const messages = useStructureFormMessages();

  const schema = useMemo(() => createCampusFormSchema(messages), [messages]);
  const form = useForm<CampusFormValues>({
    resolver: zodResolver(schema),
    defaultValues: record ? recordToCampusFormValues(record) : defaultCampusFormValues(),
  });

  const { handleSubmit, formError, isPending } = useFormDialogSubmit({
    form,
    mutationFn: (values: CampusFormValues) =>
      record
        ? Services.schoolOrganization.updateCampus(record.id, buildCampusInput(values))
        : Services.schoolOrganization.createCampus(buildCampusInput(values)),
    knownFields: CAMPUS_ERROR_FIELDS,
    onSuccess: () => {
      invalidate();
      toast.success(t("campuses.saved"));
      onOpenChange(false);
    },
    fallbackMessage: tCommon("submitFailed"),
  });

  return (
    <FormDialogLayout
      open={open}
      onOpenChange={onOpenChange}
      title={record ? t("campuses.form.editTitle") : t("campuses.form.createTitle")}
      description={t("campuses.form.description")}
      form={form}
      onSubmit={handleSubmit}
      formError={formError}
      isPending={isPending}
      submittingLabel={tCommon("saving")}
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <TextFormField
          form={form}
          name="name"
          label={t("fields.name")}
          maxLength={CAMPUS_NAME_MAX}
        />
        <TextFormField
          form={form}
          name="code"
          label={t("fields.code")}
          maxLength={CAMPUS_CODE_MAX}
          description={t("form.codeHint")}
        />
        <TextFormField
          form={form}
          name="phone"
          type="tel"
          label={t("fields.phone")}
          maxLength={CAMPUS_PHONE_MAX}
        />
        <TextFormField
          form={form}
          name="email"
          type="email"
          label={t("fields.email")}
          maxLength={CAMPUS_EMAIL_MAX}
        />
      </div>
      <TextFormField
        form={form}
        name="timezone"
        label={t("fields.timezone")}
        maxLength={CAMPUS_TIMEZONE_MAX}
        placeholder={t("form.timezonePlaceholder")}
        description={t("campuses.form.timezoneHint")}
      />
      <SwitchFormField
        form={form}
        name="is_primary"
        label={t("campuses.form.isPrimary")}
        description={t("campuses.form.isPrimaryHint")}
      />
      <SwitchFormField
        form={form}
        name="is_active"
        label={t("fields.isActive")}
        description={t("form.isActiveHint")}
      />
    </FormDialogLayout>
  );
}
