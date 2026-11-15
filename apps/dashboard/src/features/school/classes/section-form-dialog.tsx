"use client";

import { useMemo } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { FormDialogLayout } from "@/components/form-dialog-layout";
import { FormSelectField } from "@/components/form-select-field";
import { FormSwitchField } from "@/components/form-switch-field";
import { FormTextField } from "@/components/form-text-field";
import { useStructureFormMessages } from "@/features/school/shared/use-structure-form-messages";
import { useFormDialogSubmit } from "@/hooks/use-form-dialog-submit";
import { useInvalidateModule } from "@/hooks/use-invalidate-module";
import { useCampuses, useClasses } from "@/hooks/use-reference-data";
import { Services, type SectionRecord } from "@/services";
import {
  SCHOOL_ORGANIZATION_QUERY_MODULE,
  SECTION_ERROR_FIELDS,
  SECTION_NAME_MAX,
} from "@/services/modules/school-organization/school-organization-constant";
import {
  buildSectionInput,
  defaultSectionFormValues,
  recordToSectionFormValues,
} from "@/services/modules/school-organization/school-organization-helper";
import {
  createSectionFormSchema,
  type SectionFormValues,
} from "@/services/modules/school-organization/school-organization.schema";

export interface SectionFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The class the section is added from; a new section starts in it. */
  classId: string;
  /** The section to edit; omitted to add one. */
  record?: SectionRecord;
}

/**
 * Adds a section to a class at one campus, or edits one. The class and campus pickers offer only
 * the active ones, as the server refuses an inactive class or campus (`SectionSerializer`); a
 * blank capacity is unlimited. A server error that names a field shows under it.
 *
 * Mounting contract: the caller mounts this only while it is open, so every open is a fresh
 * form. An edit starts from the row the panel holds, so no prefill lands after mount.
 */
export function SectionFormDialog({ open, onOpenChange, classId, record }: SectionFormDialogProps) {
  const t = useTranslations("school");
  const tCommon = useTranslations("common");
  const invalidate = useInvalidateModule(SCHOOL_ORGANIZATION_QUERY_MODULE);
  const messages = useStructureFormMessages();
  const classesQuery = useClasses({ isActive: true });
  const campusesQuery = useCampuses({ isActive: true });

  const schema = useMemo(() => createSectionFormSchema(messages), [messages]);
  const form = useForm<SectionFormValues>({
    resolver: zodResolver(schema),
    defaultValues: record ? recordToSectionFormValues(record) : defaultSectionFormValues(classId),
  });

  const { handleSubmit, formError, isPending } = useFormDialogSubmit({
    form,
    mutationFn: (values: SectionFormValues) =>
      record
        ? Services.schoolOrganization.updateSection(record.id, buildSectionInput(values))
        : Services.schoolOrganization.createSection(buildSectionInput(values)),
    knownFields: SECTION_ERROR_FIELDS,
    onSuccess: () => {
      invalidate();
      toast.success(t("sections.saved"));
      onOpenChange(false);
    },
    fallbackMessage: tCommon("submitFailed"),
  });

  const loadingOr = (label: string, isLoading: boolean) => (isLoading ? tCommon("loading") : label);

  return (
    <FormDialogLayout
      open={open}
      onOpenChange={onOpenChange}
      title={record ? t("sections.form.editTitle") : t("sections.form.createTitle")}
      description={t("sections.form.description")}
      form={form}
      onSubmit={handleSubmit}
      formError={formError}
      isPending={isPending}
      submittingLabel={tCommon("saving")}
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormSelectField
          form={form}
          name="class_id"
          label={t("sections.fields.class")}
          placeholder={loadingOr(t("sections.fields.class"), classesQuery.isPending)}
          options={classesQuery.data ?? []}
        />
        <FormSelectField
          form={form}
          name="campus_id"
          label={t("fields.campus")}
          placeholder={loadingOr(t("fields.campus"), campusesQuery.isPending)}
          options={campusesQuery.data ?? []}
        />
        <FormTextField
          form={form}
          name="name"
          label={t("fields.name")}
          maxLength={SECTION_NAME_MAX}
          placeholder={t("sections.form.namePlaceholder")}
        />
        <FormTextField
          form={form}
          name="capacity"
          label={t("sections.fields.capacity")}
          description={t("sections.form.capacityHint")}
        />
      </div>
      <FormSwitchField
        form={form}
        name="is_active"
        label={t("fields.isActive")}
        description={t("form.isActiveHint")}
      />
    </FormDialogLayout>
  );
}
