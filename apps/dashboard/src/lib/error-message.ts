import { ApiError } from "@schoolhub/api-client";
import type { FieldValues, Path, UseFormReturn } from "react-hook-form";

/** The two members of a next-intl `useTranslations("errors")` translator this needs. */
export interface ErrorCodeTranslator {
  (key: string): string;
  has: (key: string) => boolean;
}

/**
 * The message to show for a failed request — the API's own error, never an invented one
 * (AGENTS.md Hard Rule 4), in this precedence: the envelope's field detail for `field`,
 * when one is named and present; then the error code's own `errors.*` translation; then
 * the API's raw message. `fallback` is only for an error that isn't an `ApiError` at all.
 */
export function resolveErrorMessage(
  error: unknown,
  tErrors: ErrorCodeTranslator,
  fallback: string,
  field?: string,
): string {
  if (!(error instanceof ApiError)) return fallback;
  const fieldIssue = field === undefined ? undefined : error.fieldErrors()[field];
  return fieldIssue ?? (tErrors.has(error.code) ? tErrors(error.code) : error.message);
}

/**
 * Maps a failed mutation's server field errors onto a react-hook-form instance, falling
 * back to a dialog-level message when nothing matches a known field — the one mapping
 * loop every form dialog in this module needs, instead of each redeclaring it.
 */
export function applyServerFieldErrors<TValues extends FieldValues>({
  error,
  form,
  knownFields,
  tErrors,
  fallback,
  setFormError,
}: {
  error: unknown;
  form: Pick<UseFormReturn<TValues>, "setError" | "clearErrors">;
  knownFields: readonly string[];
  tErrors: ErrorCodeTranslator;
  fallback: string;
  setFormError: (message: string | null) => void;
}): void {
  setFormError(null);
  form.clearErrors();
  if (!(error instanceof ApiError)) {
    setFormError(fallback);
    return;
  }
  let matchedAField = false;
  for (const [field, issue] of Object.entries(error.fieldErrors())) {
    if (field !== "non_field" && knownFields.includes(field)) {
      form.setError(field as Path<TValues>, { type: "server", message: issue });
      matchedAField = true;
    }
  }
  if (!matchedAField) {
    setFormError(resolveErrorMessage(error, tErrors, fallback, "non_field"));
  }
}
