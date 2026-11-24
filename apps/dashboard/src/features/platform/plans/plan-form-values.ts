import type { PlanInput, PlanRecord, PlanUpdateInput } from "@/services";
import { QUOTA_METRICS } from "@/services/modules/platform/platform-constant";
import { formatLimit, limitsFromText } from "@/services/modules/platform/platform-helper";
import type { PlanFormValues } from "@/services/modules/platform/platform.schema";

/** A new plan's form: monthly, a 14-day trial (`PLATFORM_DEFAULT_TRIAL_DAYS`), every limit blank
 * (unlimited) and no modules. */
export function emptyPlanValues(): PlanFormValues {
  return {
    name: "",
    code: "",
    description: "",
    price_amount: "",
    currency: "PKR",
    billing_period: "monthly",
    trial_days: "14",
    enabled_modules: [],
    is_active: true,
    limits: Object.fromEntries(QUOTA_METRICS.map((metric) => [metric, ""])),
  };
}

export function planToFormValues(plan: PlanRecord): PlanFormValues {
  return {
    name: plan.name,
    code: plan.code,
    description: plan.description,
    price_amount: plan.price_amount,
    currency: plan.currency,
    billing_period: plan.billing_period,
    trial_days: String(plan.trial_days),
    enabled_modules: [...plan.enabled_modules],
    is_active: plan.is_active,
    limits: Object.fromEntries(
      QUOTA_METRICS.map((metric) => [metric, formatLimit(plan.limits[metric])]),
    ),
  };
}

/** Every field but the code, which is set once at create. Every quota metric is sent, blank as
 * `null` (unlimited). */
function planBody(values: PlanFormValues): Omit<PlanInput, "code"> {
  return {
    name: values.name,
    description: values.description,
    price_amount: values.price_amount,
    currency: values.currency,
    billing_period: values.billing_period,
    trial_days: Number(values.trial_days),
    enabled_modules: values.enabled_modules,
    limits: limitsFromText(QUOTA_METRICS, values.limits),
    is_active: values.is_active,
  };
}

/** The create body. */
export function toPlanInput(values: PlanFormValues): PlanInput {
  return { ...planBody(values), code: values.code };
}

/** The edit body: no code, since it is fixed once the plan exists. `acknowledge_over_usage` is
 * sent only when the operator has acknowledged, never by default. */
export function toPlanUpdate(values: PlanFormValues, acknowledged: boolean): PlanUpdateInput {
  const body = planBody(values);
  return acknowledged ? { ...body, acknowledge_over_usage: true } : body;
}
