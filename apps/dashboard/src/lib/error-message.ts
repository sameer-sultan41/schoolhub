import { ApiError } from "@schoolhub/api-client";

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
