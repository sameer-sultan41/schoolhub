"use client";

import { ApiError } from "@schoolhub/api-client";
import { Alert, AlertDescription } from "@schoolhub/ui";
import { useTranslations } from "next-intl";

interface ApiErrorAlertProps {
  error: unknown;
}

/**
 * The API error envelope, rendered — the one copy.
 *
 * A known `error.code` resolves to its translated message, an unknown one falls back to
 * the server's own `message`, and the request id is appended so support can find the log
 * line. Never a message this app invented (AGENTS.md, hard rule 4).
 *
 * This lived three times over: `features/academics/academics-error-alert.tsx`,
 * `features/timetable/timetable-error-alert.tsx` (byte-identical to it), and a third
 * copy inlined into `students-table.tsx` and its neighbours. The argument for copying
 * was that a feature folder stays self-contained — but the behaviour is the error
 * *envelope*, which is a platform contract, not a module's presentation, and three
 * copies is three places to fall out of step with `messages.errors`.
 *
 * Renders nothing for a non-`ApiError` rejection: everything `apiClient` rejects with is
 * an `ApiError` (transport failures included — see the class docstring), so anything
 * else is a programming error, not something to show a user.
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
 * A validation failure normally arrives as `details[]` with a `field`, which the form
 * routes into `setError` — showing the envelope on top of that would say the same thing
 * twice. But the API also raises `DomainRuleViolation` with no field at all
 * (`map_subject_to_class`'s "weekly_periods must be at least 1.", or timetable's
 * "there is no draft to publish"), which is still a 422 yet names nothing the form has
 * an input for: `fieldErrors()` comes back empty, nothing reaches `setError`, and
 * without this the user would be told nothing whatsoever.
 *
 * So: show the envelope for any non-validation failure, and for a validation failure
 * that named no field.
 */
export function unhandledEnvelopeError(error: unknown): ApiError | null {
  if (!(error instanceof ApiError)) return null;
  if (!error.isValidation) return error;
  return Object.keys(error.fieldErrors()).length === 0 ? error : null;
}
