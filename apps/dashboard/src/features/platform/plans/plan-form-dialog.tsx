"use client";

import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { FormDialogLayout } from "@/components/form-dialog-layout";
import { useFormDialogSubmit } from "@/hooks/use-form-dialog-submit";
import { useInvalidateModule } from "@/hooks/use-invalidate-module";
import { Services, type OverUsage, type PlanRecord } from "@/services";
import { PLATFORM_QUERY_MODULE } from "@/services/modules/platform/platform-constant";
import {
  createPlanFormSchema,
  type PlanFormValues,
} from "@/services/modules/platform/platform.schema";
import { usePlatformFormMessages } from "@/features/platform/shared/use-platform-form-messages";
import { AcknowledgeOverUsageDialog } from "@/features/platform/shared/acknowledge-over-usage-dialog";
import {
  overUsageOf,
  usePlatformErrorDescriber,
} from "@/features/platform/shared/use-platform-error";
import { PlanFormFields } from "./plan-form-fields";
import { PlanModulesField } from "./plan-modules-field";
import { emptyPlanValues, planToFormValues, toPlanInput, toPlanUpdate } from "./plan-form-values";

export interface PlanFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The plan to edit; without one the dialog creates a plan. */
  plan?: PlanRecord;
}

const FIELDS = [
  "name",
  "code",
  "description",
  "price_amount",
  "currency",
  "billing_period",
  "trial_days",
  "enabled_modules",
  "is_active",
  "limits",
] as const;

/**
 * Creates a plan, or edits one; module access follows at once for every school on it. Lowering a
 * limit below a school's latest usage is a 409 `limit_below_usage`: the dialog then lists each
 * breach and resends the same change with `acknowledge_over_usage: true` only once the operator
 * says so; cancelling leaves the form open and unsaved.
 *
 * Mounting contract: mounted only while open, so each open starts from the record.
 */
export function PlanFormDialog({ open, onOpenChange, plan }: PlanFormDialogProps) {
  const t = useTranslations("platform");
  const tCommon = useTranslations("common");
  const invalidate = useInvalidateModule(PLATFORM_QUERY_MODULE);
  const describeError = usePlatformErrorDescriber();
  const [overUsage, setOverUsage] = useState<{
    breaches: OverUsage[];
    values: PlanFormValues;
  } | null>(null);

  const messages = usePlatformFormMessages();
  const schema = useMemo(() => createPlanFormSchema(messages), [messages]);
  const form = useForm<PlanFormValues>({
    resolver: zodResolver(schema),
    defaultValues: plan ? planToFormValues(plan) : emptyPlanValues(),
  });

  const save = (values: PlanFormValues, acknowledged: boolean) =>
    plan
      ? Services.platform.updatePlan(plan.id, toPlanUpdate(values, acknowledged))
      : Services.platform.createPlan(toPlanInput(values));

  const saved = (result: PlanRecord) => {
    invalidate();
    toast.success(t(plan ? "plans.form.saved" : "plans.form.created", { name: result.name }));
    setOverUsage(null);
    onOpenChange(false);
  };

  const { handleSubmit, formError, isPending } = useFormDialogSubmit({
    form,
    knownFields: FIELDS,
    fallbackMessage: tCommon("submitFailed"),
    describeError,
    mutationFn: (values: PlanFormValues) => save(values, false),
    onSuccess: saved,
    onError: (error, values) => {
      const breaches = overUsageOf(error);
      if (breaches) setOverUsage({ breaches, values });
    },
  });

  return (
    <>
      <FormDialogLayout
        open={open}
        onOpenChange={onOpenChange}
        title={plan ? t("plans.form.editTitle", { name: plan.name }) : t("plans.form.createTitle")}
        description={plan ? t("plans.form.editDescription") : undefined}
        form={form}
        onSubmit={handleSubmit}
        formError={formError}
        isPending={isPending}
        submittingLabel={tCommon("saving")}
      >
        <PlanFormFields form={form} isEdit={plan !== undefined} />
        <PlanModulesField form={form} />
      </FormDialogLayout>
      {overUsage && (
        <AcknowledgeOverUsageDialog
          breaches={overUsage.breaches}
          onCancel={() => {
            setOverUsage(null);
          }}
          resend={() => save(overUsage.values, true)}
          onSaved={saved}
        />
      )}
    </>
  );
}
