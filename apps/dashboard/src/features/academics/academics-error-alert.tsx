"use client";

import { ApiError } from "@schoolhub/api-client";
import { Alert, AlertDescription } from "@schoolhub/ui";
import { useTranslations } from "next-intl";

interface ApiErrorAlertProps {
  error: unknown;
}

/**
 * The API error envelope, rendered. Exactly the expression staff-table.tsx and
 * student-detail.tsx inline — a known `error.code` resolves to its translated
 * message, an unknown one falls back to the server's own `message`, and the
 * request id is appended so support can find the log line. Never a message this
 * app invented.
 *
 * Factored out rather than re-inlined because this module has nine surfaces that
 * need it, where staff/students each have two or three; the behaviour is
 * identical, and one copy is one place to keep in step with `messages.errors`.
 *
 * Renders nothing for a non-`ApiError` rejection: everything `apiClient` rejects
 * with is an `ApiError` (transport failures included — see the class docstring),
 * so anything else is a programming error, not something to show a user.
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
 * same thing twice. But the API also raises `DomainRuleViolation` with a plain
 * string (`map_subject_to_class`'s "weekly_periods must be at least 1.", for one),
 * which is still a 422 yet carries no field at all: `fieldErrors()` comes back
 * empty, nothing reaches `setError`, and without this the user would be told
 * nothing whatsoever.
 *
 * So: show the envelope for any non-validation failure, and for a validation
 * failure that named no field.
 */
export function unhandledEnvelopeError(error: unknown): ApiError | null {
  if (!(error instanceof ApiError)) return null;
  if (!error.isValidation) return error;
  return Object.keys(error.fieldErrors()).length === 0 ? error : null;
}
