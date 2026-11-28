"use client";

import { useForm } from "react-hook-form";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { FormDialogLayout } from "@/components/form-dialog-layout";
import { FormSelectField } from "@/components/form-select-field";
import { useFormDialogSubmit } from "@/hooks/use-form-dialog-submit";
import { useIdempotencyKey } from "@/hooks/use-idempotency-key";
import { useInvalidateModule } from "@/hooks/use-invalidate-module";
import { Services, type TenantRecord } from "@/services";
import { PLATFORM_QUERY_MODULE } from "@/services/modules/platform/platform-constant";
import { useActivePlans } from "@/features/platform/shared/use-platform-options";

/** The "trial without a plan" item's value; `FormSelectField` stores the pick as `""`. */
const NO_PLAN = "none";

interface ProvisionValues {
  plan_code: string;
}

/**
 * Provisions a school: seeds its settings, invites the owner at the contact email and starts the
 * trial, on a plan when one is picked (its trial length), else on none. Mounting contract: the
 * caller mounts it only while open, so each open has a fresh `Idempotency-Key`.
 */
export function ProvisionDialog({
  tenant,
  open,
  onOpenChange,
}: {
  tenant: TenantRecord;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("platform");
  const tCommon = useTranslations("common");
  const invalidate = useInvalidateModule(PLATFORM_QUERY_MODULE);
  const plans = useActivePlans();

  const form = useForm<ProvisionValues>({ defaultValues: { plan_code: "" } });
  const key = useIdempotencyKey(form);

  const { handleSubmit, formError, isPending } = useFormDialogSubmit({
    form,
    knownFields: ["plan_code"],
    fallbackMessage: tCommon("submitFailed"),
    mutationFn: ({ plan_code }: ProvisionValues) =>
      Services.platform.provisionTenant(tenant.id, plan_code ? { plan_code } : {}, {
        idempotencyKey: key.current(),
      }),
    onSuccess: () => {
      key.clear();
      invalidate();
      toast.success(t("lifecycle.provision.done", { name: tenant.name }));
      onOpenChange(false);
    },
  });

  return (
    <FormDialogLayout
      open={open}
      onOpenChange={onOpenChange}
      title={t("lifecycle.provision.title", { name: tenant.name })}
      description={t("lifecycle.provision.description", { email: tenant.contact_email })}
      form={form}
      onSubmit={handleSubmit}
      formError={formError}
      isPending={isPending}
      submittingLabel={t("lifecycle.provision.submitting")}
      submitLabel={t("lifecycle.provision.submit")}
    >
      <FormSelectField
        form={form}
        name="plan_code"
        label={t("lifecycle.provision.plan")}
        placeholder={t("lifecycle.provision.plan")}
        description={t("lifecycle.provision.planHint")}
        emptyOption={{ value: NO_PLAN, label: t("lifecycle.provision.noPlan") }}
        options={(plans.data ?? []).map((plan) => ({ id: plan.code, name: plan.name }))}
      />
    </FormDialogLayout>
  );
}
