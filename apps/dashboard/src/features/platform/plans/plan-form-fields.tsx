"use client";

import { useTranslations } from "next-intl";
import type { UseFormReturn } from "react-hook-form";

import { FormSelectField } from "@/components/form-select-field";
import { FormSwitchField } from "@/components/form-switch-field";
import { FormTextField } from "@/components/form-text-field";
import { enumLabel } from "@/lib/enum-label";
import {
  BILLING_PERIODS,
  QUOTA_METRICS,
  type QuotaMetric,
} from "@/services/modules/platform/platform-constant";
import type { PlanFormValues } from "@/services/modules/platform/platform.schema";

const PERIOD_LABELS = {
  monthly: "plans.period.monthly",
  annual: "plans.period.annual",
} as const;

const LIMIT_LABELS: Record<QuotaMetric, string> = {
  students: "plans.form.limits.students",
  staff: "plans.form.limits.staff",
  storage_gb: "plans.form.limits.storage_gb",
  sms_credits: "plans.form.limits.sms_credits",
  ai_tokens: "plans.form.limits.ai_tokens",
};

/** The plan's own fields and its limits; the modules are `PlanModulesField`. The code is fixed
 * once the plan exists (`isEdit`). Each limit is a whole number, or blank for unlimited. */
export function PlanFormFields({
  form,
  isEdit,
}: {
  form: UseFormReturn<PlanFormValues>;
  isEdit: boolean;
}) {
  const t = useTranslations("platform");

  return (
    <>
      <FormTextField form={form} name="name" label={t("plans.form.name")} maxLength={100} />
      <FormTextField
        form={form}
        name="code"
        label={t("plans.form.code")}
        description={t(isEdit ? "plans.form.codeLocked" : "plans.form.codeHint")}
        maxLength={50}
        disabled={isEdit}
        autoComplete="off"
      />
      <FormTextField
        form={form}
        name="description"
        label={t("plans.form.description")}
        maxLength={1000}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <FormTextField
          form={form}
          name="price_amount"
          label={t("plans.form.price")}
          inputMode="decimal"
        />
        <FormTextField
          form={form}
          name="currency"
          label={t("plans.form.currency")}
          description={t("plans.form.currencyHint")}
          maxLength={3}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormSelectField
          form={form}
          name="billing_period"
          label={t("plans.form.billingPeriod")}
          placeholder={t("plans.form.billingPeriod")}
          options={BILLING_PERIODS.map((period) => ({
            id: period,
            name: enumLabel(t, PERIOD_LABELS, period),
          }))}
        />
        <FormTextField
          form={form}
          name="trial_days"
          label={t("plans.form.trialDays")}
          inputMode="numeric"
        />
      </div>
      <FormSwitchField
        form={form}
        name="is_active"
        label={t("plans.form.isActive")}
        description={t("plans.form.isActiveHint")}
      />
      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">{t("plans.form.limitsLegend")}</legend>
        <p className="text-sm text-muted-foreground">{t("plans.form.limitsHint")}</p>
        <div className="grid gap-4 sm:grid-cols-2">
          {QUOTA_METRICS.map((metric) => (
            <FormTextField
              key={metric}
              form={form}
              name={`limits.${metric}`}
              label={enumLabel(t, LIMIT_LABELS, metric)}
              inputMode="numeric"
            />
          ))}
        </div>
      </fieldset>
    </>
  );
}
