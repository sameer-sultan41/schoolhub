"use client";

import { useMemo } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { FormDialogLayout } from "@/components/form-dialog-layout";
import { FormTextField } from "@/components/form-text-field";
import { useFormDialogSubmit } from "@/hooks/use-form-dialog-submit";
import { useInvalidateModule } from "@/hooks/use-invalidate-module";
import { Services, type TenantRecord } from "@/services";
import { PLATFORM_QUERY_MODULE } from "@/services/modules/platform/platform-constant";
import {
  createTenantFormSchema,
  type TenantFormValues,
} from "@/services/modules/platform/platform.schema";
import { usePlatformFormMessages } from "@/features/platform/shared/use-platform-form-messages";

const FIELDS = ["name", "slug", "contact_name", "contact_email", "contact_phone"] as const;

export interface TenantFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The school to edit; without one the dialog creates a school, in provisioning. */
  tenant?: TenantRecord;
}

/**
 * Creates a school, or edits its name and contact. The subdomain is fixed once the school is
 * provisioned (the server ignores a changed one), so the field is read-only from then on.
 *
 * Mounting contract: callers mount it only while open, so every open starts from the record.
 */
export function TenantFormDialog({ open, onOpenChange, tenant }: TenantFormDialogProps) {
  const t = useTranslations("platform");
  const tCommon = useTranslations("common");
  const invalidate = useInvalidateModule(PLATFORM_QUERY_MODULE);
  const slugLocked = tenant !== undefined && tenant.status !== "provisioning";
  const messages = usePlatformFormMessages();
  const schema = useMemo(() => createTenantFormSchema(messages), [messages]);

  const form = useForm<TenantFormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: tenant?.name ?? "",
      slug: tenant?.slug ?? "",
      contact_name: tenant?.contact_name ?? "",
      contact_email: tenant?.contact_email ?? "",
      contact_phone: tenant?.contact_phone ?? "",
    },
  });

  const { handleSubmit, formError, isPending } = useFormDialogSubmit({
    form,
    knownFields: FIELDS,
    fallbackMessage: tCommon("submitFailed"),
    mutationFn: (values: TenantFormValues) => {
      if (!tenant) return Services.platform.createTenant(values);
      const { slug, ...rest } = values;
      return Services.platform.updateTenant(tenant.id, slugLocked ? rest : { ...rest, slug });
    },
    onSuccess: (saved) => {
      invalidate();
      toast.success(
        t(tenant ? "tenants.form.saved" : "tenants.form.created", { name: saved.name }),
      );
      onOpenChange(false);
    },
  });

  return (
    <FormDialogLayout
      open={open}
      onOpenChange={onOpenChange}
      title={
        tenant ? t("tenants.form.editTitle", { name: tenant.name }) : t("tenants.form.createTitle")
      }
      description={tenant ? undefined : t("tenants.form.createDescription")}
      form={form}
      onSubmit={handleSubmit}
      formError={formError}
      isPending={isPending}
      submittingLabel={tCommon("saving")}
      submitLabel={tenant ? undefined : t("tenants.form.createSubmit")}
    >
      <FormTextField form={form} name="name" label={t("tenants.form.name")} maxLength={200} />
      <FormTextField
        form={form}
        name="slug"
        label={t("tenants.form.slug")}
        description={t(slugLocked ? "tenants.form.slugLocked" : "tenants.form.slugHint")}
        maxLength={63}
        disabled={slugLocked}
        autoComplete="off"
      />
      <FormTextField
        form={form}
        name="contact_name"
        label={t("tenants.form.contactName")}
        maxLength={200}
      />
      <FormTextField
        form={form}
        name="contact_email"
        label={t("tenants.form.contactEmail")}
        description={t("tenants.form.contactEmailHint")}
        type="email"
      />
      <FormTextField
        form={form}
        name="contact_phone"
        label={t("tenants.form.contactPhone")}
        type="tel"
        maxLength={30}
      />
    </FormDialogLayout>
  );
}
