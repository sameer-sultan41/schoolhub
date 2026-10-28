import { ApiError } from "@/services";
import { NON_FIELD } from "@/lib/error-message";

/**
 * A 409's sentence ("This correction was already approved.") names no field, so the generic
 * `errors.conflict` text would replace it; re-keyed as the form's own message, the server's
 * sentence shows. Shared by the decision dialogs, whose 409 means someone decided first.
 */
export function keepServerMessage(error: ApiError): ApiError {
  return new ApiError({
    code: error.code,
    message: error.message,
    status: error.status,
    url: error.url,
    details: [{ field: NON_FIELD, issue: error.message }],
    requestId: error.requestId,
    meta: error.meta,
  });
}
