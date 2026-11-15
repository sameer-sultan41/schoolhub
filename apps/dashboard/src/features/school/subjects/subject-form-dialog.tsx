"use client";

import { useMemo } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { FormDialogLayout } from "@/components/form-dialog-layout";
import { FormSelectField } from "@/components/form-select-field";
import { SwitchFormField, TextFormField } from "@/features/school/shared/text-form-field";
import { useStructureFormMessages } from "@/features/school/shared/use-structure-form-messages";
import { useFormDialogSubmit } from "@/hooks/use-form-dialog-submit";
import { useInvalidateModule } from "@/hooks/use-invalidate-module";
import { useDepartments } from "@/hooks/use-reference-data";
import { Services, type SubjectRecord } from "@/services";
import {
  NO_DEPARTMENT_OPTION,
  SCHOOL_ORGANIZATION_QUERY_MODULE,
  SUBJECT_CODE_MAX,
  SUBJECT_DESCRIPTION_MAX,
  SUBJECT_ERROR_FIELDS,
  SUBJECT_NAME_MAX,
  SUBJECT_TYPES,
} from "@/services/modules/school-organization/school-organization-constant";
import {
  buildSubjectInput,
  defaultSubjectFormValues,
  recordToSubjectFormValues,
} from "@/services/modules/school-organization/school-organization-helper";
import {
  createSubjectFormSchema,
  type SubjectFormValues,
} from "@/services/modules/school-organization/school-organization.schema";

export interface SubjectFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The subject to edit; omitted to add one. */
  record?: SubjectRecord;
}

/**
 * Adds a subject, or edits one. "No department" sends a null department. A server error that
 * names a field shows under it; any other is the form's own message.
 *
 * Mounting contract: the caller mounts this only while it is open, so every open is a fresh
 * form. An edit starts from the row the table holds, so no prefill lands after mount.
 */
export function SubjectFormDialog({ open, onOpenChange, record }: SubjectFormDialogProps) {
  const t = useTranslations("school");
  const tCommon = useTranslations("common");
  const invalidate = useInvalidateModule(SCHOOL_ORGANIZATION_QUERY_MODULE);
  const messages = useStructureFormMessages();
  const departmentsQuery = useDepartments();

  const schema = useMemo(() => createSubjectFormSchema(messages), [messages]);
  const form = useForm<SubjectFormValues>({
    resolver: zodResolver(schema),
    defaultValues: record ? recordToSubjectFormValues(record) : defaultSubjectFormValues(),
  });

  const { handleSubmit, formError, isPending } = useFormDialogSubmit({
    form,
    mutationFn: (values: SubjectFormValues) =>
      record
        ? Services.schoolOrganization.updateSubject(record.id, buildSubjectInput(values))
        : Services.schoolOrganization.createSubject(buildSubjectInput(values)),
    knownFields: SUBJECT_ERROR_FIELDS,
    onSuccess: () => {
      invalidate();
      toast.success(t("subjects.saved"));
      onOpenChange(false);
    },
    fallbackMessage: tCommon("submitFailed"),
  });

  const typeOptions = SUBJECT_TYPES.map((type) => ({
    id: type,
    name: t(`subjects.types.${type}`),
  }));

  return (
    <FormDialogLayout
      open={open}
      onOpenChange={onOpenChange}
      title={record ? t("subjects.form.editTitle") : t("subjects.form.createTitle")}
      description={t("subjects.form.description")}
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
          maxLength={SUBJECT_NAME_MAX}
        />
        <TextFormField
          form={form}
          name="code"
          label={t("fields.code")}
          maxLength={SUBJECT_CODE_MAX}
          description={t("subjects.form.codeHint")}
        />
        <FormSelectField
          form={form}
          name="subject_type"
          label={t("subjects.fields.type")}
          placeholder={t("subjects.fields.type")}
          options={typeOptions}
        />
        <FormSelectField
          form={form}
          name="department_id"
          label={t("subjects.fields.department")}
          placeholder={departmentsQuery.isPending ? tCommon("loading") : t("subjects.noDepartment")}
          options={departmentsQuery.data ?? []}
          emptyOption={{ value: NO_DEPARTMENT_OPTION, label: t("subjects.noDepartment") }}
        />
      </div>
      <TextFormField
        form={form}
        name="description"
        label={t("subjects.fields.description")}
        maxLength={SUBJECT_DESCRIPTION_MAX}
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
