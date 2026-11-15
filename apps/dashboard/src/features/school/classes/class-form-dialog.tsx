"use client";

import { useMemo } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { FormDialogLayout } from "@/components/form-dialog-layout";
import { FormSwitchField } from "@/components/form-switch-field";
import { FormTextField } from "@/components/form-text-field";
import { useStructureFormMessages } from "@/features/school/shared/use-structure-form-messages";
import { useFormDialogSubmit } from "@/hooks/use-form-dialog-submit";
import { useInvalidateModule } from "@/hooks/use-invalidate-module";
import { Services, type ClassRecord } from "@/services";
import {
  CLASS_CODE_MAX,
  CLASS_ERROR_FIELDS,
  CLASS_NAME_MAX,
  SCHOOL_ORGANIZATION_QUERY_MODULE,
} from "@/services/modules/school-organization/school-organization-constant";
import {
  buildClassInput,
  defaultClassFormValues,
  recordToClassFormValues,
} from "@/services/modules/school-organization/school-organization-helper";
import {
  createClassFormSchema,
  type ClassFormValues,
} from "@/services/modules/school-organization/school-organization.schema";

export interface ClassFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The class to edit; omitted to add one. */
  record?: ClassRecord;
}

/**
 * Adds a class, or edits one. Its level is its rung on the promotion ladder, one class per rung:
 * the server names a taken level's class under the level input (`ClassSerializer`). A server
 * error that names no field is the form's own message.
 *
 * Mounting contract: the caller mounts this only while it is open, so every open is a fresh
 * form. An edit starts from the row the table holds, so no prefill lands after mount.
 */
export function ClassFormDialog({ open, onOpenChange, record }: ClassFormDialogProps) {
  const t = useTranslations("school");
  const tCommon = useTranslations("common");
  const invalidate = useInvalidateModule(SCHOOL_ORGANIZATION_QUERY_MODULE);
  const messages = useStructureFormMessages();

  const schema = useMemo(() => createClassFormSchema(messages), [messages]);
  const form = useForm<ClassFormValues>({
    resolver: zodResolver(schema),
    defaultValues: record ? recordToClassFormValues(record) : defaultClassFormValues(),
  });

  const { handleSubmit, formError, isPending } = useFormDialogSubmit({
    form,
    mutationFn: (values: ClassFormValues) =>
      record
        ? Services.schoolOrganization.updateClass(record.id, buildClassInput(values))
        : Services.schoolOrganization.createClass(buildClassInput(values)),
    knownFields: CLASS_ERROR_FIELDS,
    onSuccess: () => {
      invalidate();
      toast.success(t("classes.saved"));
      onOpenChange(false);
    },
    fallbackMessage: tCommon("submitFailed"),
  });

  return (
    <FormDialogLayout
      open={open}
      onOpenChange={onOpenChange}
      title={record ? t("classes.form.editTitle") : t("classes.form.createTitle")}
      description={t("classes.form.description")}
      form={form}
      onSubmit={handleSubmit}
      formError={formError}
      isPending={isPending}
      submittingLabel={tCommon("saving")}
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormTextField
          form={form}
          name="name"
          label={t("fields.name")}
          maxLength={CLASS_NAME_MAX}
          placeholder={t("classes.form.namePlaceholder")}
        />
        <FormTextField
          form={form}
          name="code"
          label={t("fields.code")}
          maxLength={CLASS_CODE_MAX}
        />
        <FormTextField
          form={form}
          name="level"
          label={t("classes.fields.level")}
          description={t("classes.form.levelHint")}
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
