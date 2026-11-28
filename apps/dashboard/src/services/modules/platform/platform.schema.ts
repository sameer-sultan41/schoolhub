import { z } from "zod";

import {
  BILLING_PERIODS,
  IMPERSONATION_REASON_MAX_LENGTH,
  QUOTA_METRICS,
} from "./platform-constant";

/**
 * The console's form schemas, snake_case like the API so a server field error lands on its input
 * unmapped. Mirrors platform-admin.md §11; the server stays the authority. Each takes its
 * messages already translated, as the School structure schemas do.
 */

export type PlatformFormMessages = Record<
  | "required"
  | "emailInvalid"
  | "slugInvalid"
  | "codeInvalid"
  | "amountInvalid"
  | "currencyInvalid"
  | "wholeNumber",
  string
>;

/** `SLUG_PATTERN` (`apps/api/apps/platform_admin/constants.py`), one pattern. */
export const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$/;
const PLAN_CODE_PATTERN = /^[a-z0-9][a-z0-9_-]{0,49}$/;
const AMOUNT_PATTERN = /^\d+(\.\d{1,2})?$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;
const WHOLE_NUMBER_PATTERN = /^\d+$/;
/** A limit: blank (unlimited) or a whole number of zero or more. */
const LIMIT_PATTERN = /^\d*$/;

const requiredText = (max: number, messages: PlatformFormMessages) =>
  z.string().trim().min(1, messages.required).max(max);

export function createTenantFormSchema(messages: PlatformFormMessages) {
  return z.object({
    name: requiredText(200, messages),
    slug: z.string().trim().regex(SLUG_PATTERN, messages.slugInvalid),
    contact_name: requiredText(200, messages),
    contact_email: z.email(messages.emailInvalid),
    contact_phone: z.string().trim().max(30),
  });
}
export type TenantFormValues = z.infer<ReturnType<typeof createTenantFormSchema>>;

/** A reason the server requires non-blank (`:suspend`, `:delete`, `:restore`). */
export function createReasonSchema(messages: PlatformFormMessages) {
  return z.object({ reason: requiredText(500, messages) });
}
export type ReasonFormValues = z.infer<ReturnType<typeof createReasonSchema>>;

export function createPlanFormSchema(messages: PlatformFormMessages) {
  const limit = z.string().trim().regex(LIMIT_PATTERN, messages.wholeNumber);
  return z.object({
    name: requiredText(100, messages),
    code: z.string().trim().regex(PLAN_CODE_PATTERN, messages.codeInvalid),
    description: z.string().trim().max(1000),
    price_amount: z.string().trim().regex(AMOUNT_PATTERN, messages.amountInvalid),
    currency: z.string().trim().regex(CURRENCY_PATTERN, messages.currencyInvalid),
    billing_period: z.enum(BILLING_PERIODS),
    trial_days: z.string().trim().regex(WHOLE_NUMBER_PATTERN, messages.wholeNumber),
    enabled_modules: z.array(z.string()),
    is_active: z.boolean(),
    limits: z.object(Object.fromEntries(QUOTA_METRICS.map((metric) => [metric, limit]))),
  });
}
export type PlanFormValues = z.infer<ReturnType<typeof createPlanFormSchema>>;

/** Who to act as, why (kept in the audit log) and for how long, in minutes, as the duration
 * `Select` holds it. */
export function createImpersonateSchema(messages: PlatformFormMessages) {
  return z.object({
    user_id: z.string().min(1, messages.required),
    reason: requiredText(IMPERSONATION_REASON_MAX_LENGTH, messages),
    duration_minutes: z.string().regex(WHOLE_NUMBER_PATTERN, messages.wholeNumber),
  });
}
export type ImpersonateFormValues = z.infer<ReturnType<typeof createImpersonateSchema>>;
