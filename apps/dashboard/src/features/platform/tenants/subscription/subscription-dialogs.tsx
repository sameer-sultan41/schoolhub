"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { FormDialogLayout } from "@/components/form-dialog-layout";
import { FormSelectField } from "@/components/form-select-field";
import { FormTextField } from "@/components/form-text-field";
import { ResponsiveAlertDialog } from "@/components/responsive-alert-dialog";
import { useConfirmAction } from "@/hooks/use-confirm-action";
import { useFormDialogSubmit } from "@/hooks/use-form-dialog-submit";
import { useIdempotencyKey } from "@/hooks/use-idempotency-key";
import { useInvalidateModule } from "@/hooks/use-invalidate-module";
import { Services, type OverUsage, type SubscriptionState, type TenantRecord } from "@/services";
import { PLATFORM_QUERY_MODULE } from "@/services/modules/platform/platform-constant";
import { localInputToIso } from "@/services/modules/platform/platform-helper";
import { AcknowledgeOverUsageDialog } from "@/features/platform/shared/acknowledge-over-usage-dialog";
import { useActivePlans } from "@/features/platform/shared/use-platform-options";
import {
  overUsageOf,
  usePlatformErrorDescriber,
} from "@/features/platform/shared/use-platform-error";

/**
 * The manual billing actions on a school's subscription, the only billing path in v1. Each runs
 * under its dialog's `Idempotency-Key` and refreshes the console (a subscription change moves the
 * school's status and plan). Mounting contract for all four: mounted only while open.
 */

interface DialogProps {
  tenant: TenantRecord;
  onOpenChange: (open: boolean) => void;
}

function useSubscriptionDone(tenant: TenantRecord, onOpenChange: (open: boolean) => void) {
  const t = useTranslations("platform.subscription");
  const invalidate = useInvalidateModule(PLATFORM_QUERY_MODULE);
  return (message: string) => {
    invalidate();
    toast.success(t(message, { name: tenant.name }));
    onOpenChange(false);
  };
}

function planOptions(plans: { code: string; name: string }[] | undefined) {
  return (plans ?? []).map((plan) => ({ id: plan.code, name: plan.name }));
}

interface ActivateValues {
  plan_code: string;
  current_period_start: string;
  current_period_end: string;
}

/**
 * `:activate`: a trial converts to paying (its plan stays), or a school with no live
 * subscription starts paying for the plan picked. `subscription_exists` (409) means it already
 * has one; change its plan instead.
 */
export function ActivateSubscriptionDialog({
  tenant,
  state,
  onOpenChange,
}: DialogProps & { state: SubscriptionState }) {
  const t = useTranslations("platform.subscription");
  const tCommon = useTranslations("common");
  const plans = useActivePlans();
  const done = useSubscriptionDone(tenant, onOpenChange);
  const needsPlan = state.subscription === null;

  const form = useForm<ActivateValues>({
    defaultValues: { plan_code: "", current_period_start: "", current_period_end: "" },
  });
  const key = useIdempotencyKey(form);

  const { handleSubmit, formError, isPending } = useFormDialogSubmit({
    form,
    knownFields: ["plan_code", "current_period_start", "current_period_end"],
    fallbackMessage: tCommon("submitFailed"),
    mutationFn: (values: ActivateValues) =>
      Services.platform.activateSubscription(
        tenant.id,
        {
          ...(needsPlan ? { plan_code: values.plan_code || null } : {}),
          current_period_start: localInputToIso(values.current_period_start) ?? "",
          current_period_end: localInputToIso(values.current_period_end) ?? "",
        },
        { idempotencyKey: key.current() },
      ),
    onSuccess: () => {
      key.clear();
      done("activate.done");
    },
  });

  return (
    <FormDialogLayout
      open
      onOpenChange={onOpenChange}
      title={t("activate.title", { name: tenant.name })}
      description={t(needsPlan ? "activate.descriptionNew" : "activate.descriptionTrial")}
      form={form}
      onSubmit={handleSubmit}
      formError={formError}
      isPending={isPending}
      submittingLabel={t("activate.submitting")}
      submitLabel={t("activate.submit")}
    >
      {needsPlan && (
        <FormSelectField
          form={form}
          name="plan_code"
          label={t("plan")}
          placeholder={t("choosePlan")}
          options={planOptions(plans.data)}
        />
      )}
      <FormTextField
        form={form}
        name="current_period_start"
        type="datetime-local"
        label={t("periodStart")}
      />
      <FormTextField
        form={form}
        name="current_period_end"
        type="datetime-local"
        label={t("periodEnd")}
      />
    </FormDialogLayout>
  );
}

/** `:record-payment`: the paid period runs on to `paid_through`, and a past-due school recovers. */
export function RecordPaymentDialog({ tenant, onOpenChange }: DialogProps) {
  const t = useTranslations("platform.subscription");
  const tCommon = useTranslations("common");
  const done = useSubscriptionDone(tenant, onOpenChange);
  const form = useForm<{ paid_through: string }>({ defaultValues: { paid_through: "" } });
  const key = useIdempotencyKey(form);

  const { handleSubmit, formError, isPending } = useFormDialogSubmit({
    form,
    knownFields: ["paid_through"],
    fallbackMessage: tCommon("submitFailed"),
    mutationFn: (values: { paid_through: string }) =>
      Services.platform.recordPayment(
        tenant.id,
        { paid_through: localInputToIso(values.paid_through) ?? "" },
        { idempotencyKey: key.current() },
      ),
    onSuccess: () => {
      key.clear();
      done("recordPayment.done");
    },
  });

  return (
    <FormDialogLayout
      open
      onOpenChange={onOpenChange}
      title={t("recordPayment.title", { name: tenant.name })}
      description={t("recordPayment.description")}
      form={form}
      onSubmit={handleSubmit}
      formError={formError}
      isPending={isPending}
      submittingLabel={t("recordPayment.submitting")}
      submitLabel={t("recordPayment.submit")}
    >
      <FormTextField
        form={form}
        name="paid_through"
        type="datetime-local"
        label={t("recordPayment.paidThrough")}
        description={t("recordPayment.paidThroughHint")}
      />
    </FormDialogLayout>
  );
}

/** `:mark-payment-failed`: the subscription and the school go past due (dunning starts). */
export function MarkPaymentFailedDialog({ tenant, onOpenChange }: DialogProps) {
  const t = useTranslations("platform.subscription");
  const tCommon = useTranslations("common");
  const done = useSubscriptionDone(tenant, onOpenChange);
  // A confirm with no form: one key for this open, reused by a retry.
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  const { error, isPending, confirm } = useConfirmAction({
    mutationFn: () => Services.platform.markPaymentFailed(tenant.id, { idempotencyKey }),
    onSuccess: () => {
      done("markFailed.done");
    },
    fallbackMessage: tCommon("submitFailed"),
  });

  return (
    <ResponsiveAlertDialog
      open
      onOpenChange={onOpenChange}
      title={t("markFailed.title", { name: tenant.name })}
      description={t("markFailed.description")}
      confirmLabel={t("markFailed.confirm")}
      variant="destructive"
      isPending={isPending}
      error={error ?? undefined}
      onConfirm={confirm}
    />
  );
}

/**
 * `:change-plan`: the live subscription moves to another plan, and module access follows at once.
 * A plan whose limits sit below the school's latest usage is a 409 `limit_below_usage`: the
 * breaches are listed and the move is resent with `acknowledge_over_usage: true` only on the
 * operator's word. `toggle_refused` names the module the school still needs.
 */
export function ChangePlanDialog({
  tenant,
  state,
  onOpenChange,
}: DialogProps & { state: SubscriptionState }) {
  const t = useTranslations("platform.subscription");
  const tCommon = useTranslations("common");
  const plans = useActivePlans();
  const done = useSubscriptionDone(tenant, onOpenChange);
  const describeError = usePlatformErrorDescriber();
  const [overUsage, setOverUsage] = useState<OverUsage[] | null>(null);
  const currentCode = state.subscription?.plan.code;

  const form = useForm<{ plan_code: string }>({ defaultValues: { plan_code: "" } });
  const key = useIdempotencyKey(form);
  // The acknowledged resend is a different body, so it has its own key, stable for this open so a
  // retry after a lost answer replays rather than moving the plan twice.
  const [acknowledgedKey] = useState(() => crypto.randomUUID());
  const move = (planCode: string, acknowledged: boolean) =>
    Services.platform.changePlan(
      tenant.id,
      { plan_code: planCode, acknowledge_over_usage: acknowledged },
      { idempotencyKey: acknowledged ? acknowledgedKey : key.current() },
    );

  const { handleSubmit, formError, isPending } = useFormDialogSubmit({
    form,
    knownFields: ["plan_code"],
    fallbackMessage: tCommon("submitFailed"),
    describeError,
    mutationFn: (values: { plan_code: string }) => move(values.plan_code, false),
    onSuccess: () => {
      key.clear();
      done("changePlan.done");
    },
    onError: (error) => {
      setOverUsage(overUsageOf(error));
    },
  });

  return (
    <>
      <FormDialogLayout
        open
        onOpenChange={onOpenChange}
        title={t("changePlan.title", { name: tenant.name })}
        description={t("changePlan.description")}
        form={form}
        onSubmit={handleSubmit}
        formError={formError}
        isPending={isPending}
        submittingLabel={t("changePlan.submitting")}
        submitLabel={t("changePlan.submit")}
      >
        <FormSelectField
          form={form}
          name="plan_code"
          label={t("plan")}
          placeholder={t("choosePlan")}
          options={planOptions(plans.data?.filter((plan) => plan.code !== currentCode))}
        />
      </FormDialogLayout>
      {overUsage && (
        <AcknowledgeOverUsageDialog
          breaches={overUsage}
          onCancel={() => {
            setOverUsage(null);
          }}
          resend={() => move(form.getValues("plan_code"), true)}
          onSaved={() => {
            done("changePlan.done");
          }}
        />
      )}
    </>
  );
}
