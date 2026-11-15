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
import { Services, type HouseRecord } from "@/services";
import {
  HOUSE_CODE_MAX,
  HOUSE_COLOR_MAX,
  HOUSE_ERROR_FIELDS,
  HOUSE_MOTTO_MAX,
  HOUSE_NAME_MAX,
  SCHOOL_ORGANIZATION_QUERY_MODULE,
} from "@/services/modules/school-organization/school-organization-constant";
import {
  buildHouseInput,
  defaultHouseFormValues,
  recordToHouseFormValues,
} from "@/services/modules/school-organization/school-organization-helper";
import {
  createHouseFormSchema,
  type HouseFormValues,
} from "@/services/modules/school-organization/school-organization.schema";

export interface HouseFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The house to edit; omitted to add one. */
  record?: HouseRecord;
}

/**
 * Adds a house, or edits one. A server error that names a field shows under it (a house name
 * is unique per school); any other is the form's own message.
 *
 * Mounting contract: the caller mounts this only while it is open, so every open is a fresh
 * form.
 */
export function HouseFormDialog({ open, onOpenChange, record }: HouseFormDialogProps) {
  const t = useTranslations("school");
  const tCommon = useTranslations("common");
  const invalidate = useInvalidateModule(SCHOOL_ORGANIZATION_QUERY_MODULE);
  const messages = useStructureFormMessages();

  const schema = useMemo(() => createHouseFormSchema(messages), [messages]);
  const form = useForm<HouseFormValues>({
    resolver: zodResolver(schema),
    defaultValues: record ? recordToHouseFormValues(record) : defaultHouseFormValues(),
  });

  const { handleSubmit, formError, isPending } = useFormDialogSubmit({
    form,
    mutationFn: (values: HouseFormValues) =>
      record
        ? Services.schoolOrganization.updateHouse(record.id, buildHouseInput(values))
        : Services.schoolOrganization.createHouse(buildHouseInput(values)),
    knownFields: HOUSE_ERROR_FIELDS,
    onSuccess: () => {
      invalidate();
      toast.success(t("houses.saved"));
      onOpenChange(false);
    },
    fallbackMessage: tCommon("submitFailed"),
  });

  return (
    <FormDialogLayout
      open={open}
      onOpenChange={onOpenChange}
      title={record ? t("houses.form.editTitle") : t("houses.form.createTitle")}
      description={t("houses.form.description")}
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
          maxLength={HOUSE_NAME_MAX}
        />
        <FormTextField
          form={form}
          name="code"
          label={t("fields.code")}
          maxLength={HOUSE_CODE_MAX}
        />
        <FormTextField
          form={form}
          name="color"
          label={t("houses.fields.color")}
          maxLength={HOUSE_COLOR_MAX}
          placeholder={t("form.colorPlaceholder")}
          description={t("form.colorHint")}
        />
        <FormTextField
          form={form}
          name="motto"
          label={t("houses.fields.motto")}
          maxLength={HOUSE_MOTTO_MAX}
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
