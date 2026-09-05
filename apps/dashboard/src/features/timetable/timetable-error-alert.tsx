"use client";

import { ApiError } from "@schoolhub/api-client";
import { Alert, AlertDescription } from "@schoolhub/ui";
import { useTranslations } from "next-intl";

interface ApiErrorAlertProps {
  error: unknown;
}

/**
 * The API error envelope, rendered — the same expression academics, staff and
 * students all use: a known `error.code` resolves to its translated message, an
 * unknown one falls back to the server's own `message`, and the request id is
 * appended so support can find the log line. Never a message this app invented.
 *
 * Copied rather than imported from the academics slice: a feature folder is flat
 * and self-contained here, and cross-importing another module's presentation
 * would couple two modules' surfaces through a component neither owns.
 *
 * Renders nothing for a non-`ApiError` rejection: everything `apiClient` rejects
 * with is an `ApiError` (transport failures included), so anything else is a
 * programming error, not something to show a user.
 */
export function ApiErrorAlert({ error }: ApiErrorAlertProps) {
  const tErrors = useTranslations("errors");

  if (!(error instanceof ApiError)) return null;

  return (
    <Alert variant="danger">
      <AlertDescription>
        {tErrors.has(error.code) ? tErrors(error.code) : error.message}
        {error.requestId ? ` ${tErrors("requestId", { requestId: error.requestId })}` : ""}
      </AlertDescription>
    </Alert>
  );
}

/**
 * The part of a failed mutation the form itself has NOT already shown.
 *
 * A validation failure normally arrives as `details[]` with a `field`, which the
 * form routes into `setError` — showing the envelope on top of that would say the
 * same thing twice. But this module raises `DomainRuleViolation` against
 * `non_field` in several places (publish with unresolved hard conflicts, a
 * section with no draft at all), which is still a 422 yet names no field the form
 * has an input for: without this the user would be told nothing whatsoever.
 *
 * So: show the envelope for any non-validation failure, and for a validation
 * failure that named no field.
 */
export function unhandledEnvelopeError(error: unknown): ApiError | null {
  if (!(error instanceof ApiError)) return null;
  if (!error.isValidation) return error;
  return Object.keys(error.fieldErrors()).length === 0 ? error : null;
}
