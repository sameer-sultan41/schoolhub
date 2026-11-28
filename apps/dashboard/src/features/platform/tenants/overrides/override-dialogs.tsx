"use client";

import { useForm, useWatch } from "react-hook-form";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { FormDialogLayout } from "@/components/form-dialog-layout";
import { FormSelectField } from "@/components/form-select-field";
import { FormSwitchField } from "@/components/form-switch-field";
import { FormTextField } from "@/components/form-text-field";
import { ResponsiveAlertDialog } from "@/components/responsive-alert-dialog";
import { useConfirmAction } from "@/hooks/use-confirm-action";
import { useFormDialogSubmit } from "@/hooks/use-form-dialog-submit";
import { useInvalidateModule } from "@/hooks/use-invalidate-module";
import { Services, type FeatureOverrideRecord, type TenantRecord } from "@/services";
import { PLATFORM_QUERY_MODULE } from "@/services/modules/platform/platform-constant";
import { localInputToIso } from "@/services/modules/platform/platform-helper";
import { ReasonField } from "@/features/platform/shared/reason-field";
import { usePlatformErrorDescriber } from "@/features/platform/shared/use-platform-error";
import { useAllFlags } from "@/features/platform/shared/use-platform-options";

interface OverrideValues {
  flag: string;
  enabled: boolean;
  reason: string;
  expires_at: string;
}

const FIELDS = ["flag", "enabled", "reason", "expires_at"] as const;

/**
 * Gives the school an override of one flag, replacing any it has (pilot, support, commercial).
 * Two refusals are 409 `toggle_refused`: switching off a flag the school still needs, and
 * switching a kill switch on; both name the flag. Mounting contract: mounted only while open.
 */
export function OverrideFormDialog({
  tenant,
  onOpenChange,
}: {
  tenant: TenantRecord;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("platform.overrides");
  const tCommon = useTranslations("common");
  const invalidate = useInvalidateModule(PLATFORM_QUERY_MODULE);
  const describeError = usePlatformErrorDescriber();
  const flags = useAllFlags();

  const form = useForm<OverrideValues>({
    defaultValues: { flag: "", enabled: true, reason: "", expires_at: "" },
  });
  const [flag, reason] = useWatch({ control: form.control, name: ["flag", "reason"] });

  const { handleSubmit, formError, isPending } = useFormDialogSubmit({
    form,
    knownFields: FIELDS,
    fallbackMessage: tCommon("submitFailed"),
    describeError,
    mutationFn: (values: OverrideValues) =>
      Services.platform.createOverride(tenant.id, {
        flag: values.flag,
        enabled: values.enabled,
        reason: values.reason.trim(),
        expires_at: localInputToIso(values.expires_at),
      }),
    onSuccess: (override) => {
      invalidate();
      toast.success(t("saved", { flag: override.flag }));
      onOpenChange(false);
    },
  });

  return (
    <FormDialogLayout
      open
      onOpenChange={onOpenChange}
      title={t("createTitle", { name: tenant.name })}
      description={t("createDescription")}
      form={form}
      onSubmit={handleSubmit}
      formError={formError}
      isPending={isPending}
      submittingLabel={tCommon("saving")}
      submitDisabled={flag === "" || reason.trim() === ""}
    >
      <FormSelectField
        form={form}
        name="flag"
        label={t("flag")}
        placeholder={t("chooseFlag")}
        options={(flags.data ?? []).map((item) => ({ id: item.key, name: item.key }))}
      />
      <FormSwitchField
        form={form}
        name="enabled"
        label={t("enabled")}
        description={t("enabledHint")}
      />
      <ReasonField form={form} name="reason" description={t("reasonHint")} />
      <FormTextField
        form={form}
        name="expires_at"
        type="datetime-local"
        label={t("expiresAt")}
        description={t("expiresAtHint")}
      />
    </FormDialogLayout>
  );
}

/** Removes the school's override, so its plan or the flag's default decides again. A guard may
 * refuse (`toggle_refused`, naming the flag). Mounting contract: mounted only while open. */
export function RemoveOverrideDialog({
  tenant,
  override,
  onOpenChange,
}: {
  tenant: TenantRecord;
  override: FeatureOverrideRecord;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("platform.overrides");
  const tCommon = useTranslations("common");
  const invalidate = useInvalidateModule(PLATFORM_QUERY_MODULE);
  const describeError = usePlatformErrorDescriber();

  const { error, isPending, confirm } = useConfirmAction({
    mutationFn: () => Services.platform.deleteOverride(tenant.id, override.id),
    onSuccess: () => {
      invalidate();
      toast.success(t("removed", { flag: override.flag }));
      onOpenChange(false);
    },
    fallbackMessage: tCommon("submitFailed"),
    describeError,
  });

  return (
    <ResponsiveAlertDialog
      open
      onOpenChange={onOpenChange}
      title={t("removeTitle", { flag: override.flag })}
      description={t("removeDescription")}
      confirmLabel={t("remove")}
      variant="destructive"
      isPending={isPending}
      error={error ?? undefined}
      onConfirm={confirm}
    />
  );
}
