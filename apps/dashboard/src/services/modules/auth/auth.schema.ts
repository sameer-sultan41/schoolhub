import { z } from "zod";

/**
 * The auth module's Zod schemas — single source of truth, so a schema (and its
 * inferred form-values type) isn't redeclared per feature file.
 *
 * Mirrors the API's validation (module doc §11) so the user gets instant feedback,
 * but the API remains the authority — its `error.details` are surfaced verbatim by
 * `login-form.tsx`.
 */
export const loginSchema = z.object({
  identifier: z.string().min(1),
  password: z.string().min(1),
});

export type LoginValues = z.infer<typeof loginSchema>;
