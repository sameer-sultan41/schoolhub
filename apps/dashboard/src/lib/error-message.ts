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

/** The field key the API gives an error that belongs to no single input. */
export const NON_FIELD = "non_field";

/**
 * Re-keys every field detail outside `knownFields` as `non_field`, so a dialog-level message
 * (`resolveErrorMessage(..., "non_field")`, or `applyServerFieldErrors`' fallback) shows the
 * server's own reason for a field the dialog has no input for, instead of the code's generic
 * text. With no `knownFields`, every field detail folds: for a confirm dialog with no inputs.
 * Anything that isn't an `ApiError`, or has nothing to re-key, comes back as it was.
 */
export function foldUnknownFieldErrors(
  error: unknown,
  knownFields: readonly string[] = [],
): unknown {
  if (!(error instanceof ApiError)) return error;
  const isUnknown = (field: string | undefined) =>
    field !== undefined && field !== NON_FIELD && !knownFields.includes(field);
  if (!error.details.some((detail) => isUnknown(detail.field))) return error;
  return new ApiError({
    code: error.code,
    message: error.message,
    status: error.status,
    url: error.url,
    details: error.details.map((detail) =>
      isUnknown(detail.field) ? { ...detail, field: NON_FIELD } : detail,
    ),
    requestId: error.requestId,
    meta: error.meta,
  });
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
    if (field !== NON_FIELD && knownFields.includes(field)) {
      form.setError(field as Path<TValues>, { type: "server", message: issue });
      matchedAField = true;
    }
  }
  if (!matchedAField) {
    setFormError(resolveErrorMessage(error, tErrors, fallback, NON_FIELD));
  }
}
