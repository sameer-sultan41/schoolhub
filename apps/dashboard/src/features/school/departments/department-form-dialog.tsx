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
import { useCampuses } from "@/hooks/use-reference-data";
import { Services, type DepartmentRecord } from "@/services";
import {
  DEPARTMENT_CODE_MAX,
  DEPARTMENT_DESCRIPTION_MAX,
  DEPARTMENT_ERROR_FIELDS,
  DEPARTMENT_NAME_MAX,
  DEPARTMENT_TYPES,
  ALL_CAMPUSES_OPTION,
  SCHOOL_ORGANIZATION_QUERY_MODULE,
} from "@/services/modules/school-organization/school-organization-constant";
import {
  buildDepartmentInput,
  defaultDepartmentFormValues,
  recordToDepartmentFormValues,
} from "@/services/modules/school-organization/school-organization-helper";
import {
  createDepartmentFormSchema,
  type DepartmentFormValues,
} from "@/services/modules/school-organization/school-organization.schema";

export interface DepartmentFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The department to edit; omitted to add one. */
  record?: DepartmentRecord;
}

/**
 * Adds a department, or edits one. "All campuses" sends a null campus. A server error that
 * names a field shows under it; any other is the form's own message.
 *
 * Mounting contract: the caller mounts this only while it is open, so every open is a fresh
 * form. An edit starts from the row the table holds, so no prefill lands after mount.
 */
export function DepartmentFormDialog({ open, onOpenChange, record }: DepartmentFormDialogProps) {
  const t = useTranslations("school");
  const tCommon = useTranslations("common");
  const invalidate = useInvalidateModule(SCHOOL_ORGANIZATION_QUERY_MODULE);
  const messages = useStructureFormMessages();
  const campusesQuery = useCampuses();

  const schema = useMemo(() => createDepartmentFormSchema(messages), [messages]);
  const form = useForm<DepartmentFormValues>({
    resolver: zodResolver(schema),
    defaultValues: record ? recordToDepartmentFormValues(record) : defaultDepartmentFormValues(),
  });

  const { handleSubmit, formError, isPending } = useFormDialogSubmit({
    form,
    mutationFn: (values: DepartmentFormValues) =>
      record
        ? Services.schoolOrganization.updateDepartment(record.id, buildDepartmentInput(values))
        : Services.schoolOrganization.createDepartment(buildDepartmentInput(values)),
    knownFields: DEPARTMENT_ERROR_FIELDS,
    onSuccess: () => {
      invalidate();
      toast.success(t("departments.saved"));
      onOpenChange(false);
    },
    fallbackMessage: tCommon("submitFailed"),
  });

  const typeOptions = DEPARTMENT_TYPES.map((type) => ({
    id: type,
    name: t(`departments.types.${type}`),
  }));

  return (
    <FormDialogLayout
      open={open}
      onOpenChange={onOpenChange}
      title={record ? t("departments.form.editTitle") : t("departments.form.createTitle")}
      description={t("departments.form.description")}
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
          maxLength={DEPARTMENT_NAME_MAX}
        />
        <TextFormField
          form={form}
          name="code"
          label={t("fields.code")}
          maxLength={DEPARTMENT_CODE_MAX}
          description={t("form.codeHint")}
        />
        <FormSelectField
          form={form}
          name="department_type"
          label={t("departments.fields.type")}
          placeholder={t("departments.fields.type")}
          options={typeOptions}
        />
        <FormSelectField
          form={form}
          name="campus_id"
          label={t("fields.campus")}
          placeholder={campusesQuery.isPending ? tCommon("loading") : t("allCampuses")}
          options={campusesQuery.data ?? []}
          emptyOption={{ value: ALL_CAMPUSES_OPTION, label: t("allCampuses") }}
        />
      </div>
      <TextFormField
        form={form}
        name="description"
        label={t("departments.fields.description")}
        maxLength={DEPARTMENT_DESCRIPTION_MAX}
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
