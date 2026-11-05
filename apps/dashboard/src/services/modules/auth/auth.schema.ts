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
