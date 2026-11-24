"use client";

import { useForm } from "react-hook-form";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { FormDialogLayout } from "@/components/form-dialog-layout";
import { FormTextField } from "@/components/form-text-field";
import { useFormDialogSubmit } from "@/hooks/use-form-dialog-submit";
import { useIdempotencyKey } from "@/hooks/use-idempotency-key";
import { useInvalidateModule } from "@/hooks/use-invalidate-module";
import { Services, type TenantRecord } from "@/services";
import { PLATFORM_QUERY_MODULE } from "@/services/modules/platform/platform-constant";
import { localInputToIso } from "@/services/modules/platform/platform-helper";
import { ReasonField } from "@/features/platform/shared/reason-field";

interface ReinstateValues {
  trial_ends_at: string;
  reason: string;
}

const FIELDS = ["trial_ends_at", "reason"] as const;

/**
 * Reinstates a suspended school to the status its live subscription implies (platform-admin.md
 * §7.4). A trial end is needed only to put it back on a trial: with no live subscription, or a
 * trialing one. The server answers 409 `no_live_subscription` without one, and 409
 * `grace_expired` for a past-due school whose grace has run out (record a payment first).
 * Mounting contract: mounted only while open, so each open has a fresh `Idempotency-Key`.
 */
export function ReinstateDialog({
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

  const form = useForm<ReinstateValues>({ defaultValues: { trial_ends_at: "", reason: "" } });
  const key = useIdempotencyKey(form);

  const { handleSubmit, formError, isPending } = useFormDialogSubmit({
    form,
    knownFields: FIELDS,
    fallbackMessage: tCommon("submitFailed"),
    mutationFn: (values: ReinstateValues) => {
      const trialEndsAt = localInputToIso(values.trial_ends_at);
      return Services.platform.reinstateTenant(
        tenant.id,
        { reason: values.reason.trim(), ...(trialEndsAt ? { trial_ends_at: trialEndsAt } : {}) },
        { idempotencyKey: key.current() },
      );
    },
    onSuccess: () => {
      key.clear();
      invalidate();
      toast.success(t("lifecycle.reinstate.done", { name: tenant.name }));
      onOpenChange(false);
    },
  });

  return (
    <FormDialogLayout
      open={open}
      onOpenChange={onOpenChange}
      title={t("lifecycle.reinstate.title", { name: tenant.name })}
      description={t("lifecycle.reinstate.description")}
      form={form}
      onSubmit={handleSubmit}
      formError={formError}
      isPending={isPending}
      submittingLabel={t("lifecycle.reinstate.submitting")}
      submitLabel={t("lifecycle.reinstate.submit")}
    >
      <FormTextField
        form={form}
        name="trial_ends_at"
        type="datetime-local"
        label={t("lifecycle.reinstate.trialEndsAt")}
        description={t("lifecycle.reinstate.trialEndsAtHint")}
      />
      <ReasonField form={form} name="reason" optional />
    </FormDialogLayout>
  );
}
