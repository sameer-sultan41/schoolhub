import type { ErrorCodeTranslator } from "@/lib/error-message";
import { ApiError } from "@/services";

/**
 * The website API phrases each business-rule refusal as `<reason>: <sentence>`
 * (`apps/api/apps/website_cms/errors.py`, `pages/services.py`): `page_in_use: this page cannot
 * be removed because it is the homepage.` A reason with a `website.reasons.*` entry is shown in
 * the viewer's language; any other keeps the server's own sentence, so a refusal is never
 * silent or generic.
 */

const REASON_PREFIX = /^([a-z][a-z_]*): ([\s\S]+)$/;

/** One issue's text for a person: the reason's translation, else the server's sentence. */
export function reasonText(issue: string, tReasons: ErrorCodeTranslator): string {
  const match = REASON_PREFIX.exec(issue);
  const [, reason, sentence] = match ?? [];
  if (reason === undefined || sentence === undefined) return issue;
  if (tReasons.has(reason)) return tReasons(reason);
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

/** `error` with every field issue rewritten by `reasonText`, so whichever input or alert shows
 * it reads as a sentence; anything that isn't an `ApiError` comes back as it was. */
export function withReasonText(error: unknown, tReasons: ErrorCodeTranslator): unknown {
  if (!(error instanceof ApiError)) return error;
  return new ApiError({
    code: error.code,
    message: reasonText(error.message, tReasons),
    status: error.status,
    url: error.url,
    details: error.details.map((detail) => ({
      ...detail,
      issue: reasonText(detail.issue, tReasons),
    })),
    requestId: error.requestId,
    meta: error.meta,
  });
}
