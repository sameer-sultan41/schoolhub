import { z } from "zod";

import { PASSWORD_MIN_LENGTH } from "./auth-constant";

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

/**
 * The change-password form. Mirrors the server's length rule so the user hears it at once; the
 * server's own validators (common or numeric passwords) stay the authority and answer on
 * `new_password`. The confirmation exists only here: it is never sent.
 */
export function createChangePasswordSchema(messages: {
  currentRequired: string;
  newTooShort: string;
  confirmMismatch: string;
  sameAsCurrent: string;
}) {
  return z
    .object({
      current_password: z.string().min(1, messages.currentRequired),
      new_password: z.string().min(PASSWORD_MIN_LENGTH, messages.newTooShort),
      confirm_password: z.string(),
    })
    .superRefine((values, ctx) => {
      if (values.confirm_password !== values.new_password) {
        ctx.addIssue({
          code: "custom",
          path: ["confirm_password"],
          message: messages.confirmMismatch,
        });
      }
      if (values.current_password && values.new_password === values.current_password) {
        ctx.addIssue({ code: "custom", path: ["new_password"], message: messages.sameAsCurrent });
      }
    });
}

export type ChangePasswordFormValues = z.infer<ReturnType<typeof createChangePasswordSchema>>;
