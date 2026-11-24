import { z } from "zod";

import { BILLING_PERIODS, QUOTA_METRICS } from "./platform-constant";

/**
 * The console's form schemas, snake_case like the API so a server field error lands on its
 * input unmapped. Mirrors platform-admin.md §11; the server stays the authority.
 */

/** `SLUG_PATTERN` (`apps/api/apps/platform_admin/constants.py`), one pattern. */
export const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$/;

const requiredText = (max: number) => z.string().trim().min(1).max(max);

export const tenantFormSchema = z.object({
  name: requiredText(200),
  slug: z.string().trim().regex(SLUG_PATTERN),
  contact_name: requiredText(200),
  contact_email: z.email(),
  contact_phone: z.string().trim().max(30),
});
export type TenantFormValues = z.infer<typeof tenantFormSchema>;

/** A reason the server requires non-blank (`:suspend`, `:delete`, `:restore`). */
export const reasonSchema = z.object({ reason: z.string().trim().min(1).max(500) });
export type ReasonFormValues = z.infer<typeof reasonSchema>;

/** A limit field: blank (unlimited) or a whole number of zero or more. */
const limitText = z.string().trim().regex(/^\d*$/);

export const planFormSchema = z.object({
  name: requiredText(100),
  code: z
    .string()
    .trim()
    .regex(/^[a-z0-9][a-z0-9_-]{0,49}$/),
  description: z.string().trim().max(1000),
  price_amount: z
    .string()
    .trim()
    .regex(/^\d+(\.\d{1,2})?$/),
  currency: z
    .string()
    .trim()
    .regex(/^[A-Z]{3}$/),
  billing_period: z.enum(BILLING_PERIODS),
  trial_days: z.string().trim().regex(/^\d+$/),
  enabled_modules: z.array(z.string()),
  is_active: z.boolean(),
  limits: z.object(Object.fromEntries(QUOTA_METRICS.map((metric) => [metric, limitText]))),
});
export type PlanFormValues = z.infer<typeof planFormSchema>;
