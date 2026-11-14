import { z } from "zod";

import { PASSWORD_MIN_LENGTH } from "./auth-constant";

/**
 * The auth module's Zod schemas — single source of truth, so a schema (and its
 * inferred form-values type) isn't redeclared per feature file.
 *
 * Mirrors the API's validation (module doc §11) so the user gets instant feedback,
 * but the API remains the authority — its `error.details` are surfaced verbatim by
 * the forms.
 */
export const loginSchema = z.object({
  identifier: z.string().min(1),
  password: z.string().min(1),
});

export type LoginValues = z.infer<typeof loginSchema>;

/** The messages a failed rule shows: already translated by the caller. */
export interface NewPasswordMessages {
  tooShort: string;
  confirmRequired: string;
  mismatch: string;
}

/** Setting a password from an invitation or a reset link: typed twice, at least the
 * server's minimum length. The server's other validators (common, numeric, similar to the
 * email) answer with a field error the form shows under the password. */
export function createNewPasswordSchema(messages: NewPasswordMessages) {
  return z
    .object({
      password: z.string().min(PASSWORD_MIN_LENGTH, messages.tooShort),
      confirmPassword: z.string().min(1, messages.confirmRequired),
    })
    .refine((values) => values.password === values.confirmPassword, {
      message: messages.mismatch,
      path: ["confirmPassword"],
    });
}

export type NewPasswordValues = z.infer<ReturnType<typeof createNewPasswordSchema>>;

export function createForgotPasswordSchema(messages: { invalidEmail: string }) {
  return z.object({ email: z.email(messages.invalidEmail) });
}

export type ForgotPasswordValues = z.infer<ReturnType<typeof createForgotPasswordSchema>>;

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
