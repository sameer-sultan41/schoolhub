import type { ErrorCodeTranslator } from "@/lib/error-message";
import { ApiError } from "@/services";

/**
 * The website API phrases each business-rule refusal as `<reason>: <sentence>`
 * (`apps/api/apps/website_cms/errors.py`, `pages/services.py`): `page_in_use: this page cannot
 * be removed because it is the homepage.` A reason with a `website.reasons.*` entry is shown in
 * the viewer's language; any other keeps the server's own sentence, so a refusal is never
 * silent or generic. A record kind whose copy differs from a page's (a news post's one-segment
 * address) passes its `scope`: `website.reasons.<scope>.<reason>` is tried first.
 */

const REASON_PREFIX = /^([a-z][a-z_]*): ([\s\S]+)$/;

/** One issue's text for a person: the reason's translation, else the server's sentence. */
export function reasonText(issue: string, tReasons: ErrorCodeTranslator, scope?: string): string {
  const match = REASON_PREFIX.exec(issue);
  const [, reason, sentence] = match ?? [];
  if (reason === undefined || sentence === undefined) return issue;
  const scoped = scope === undefined ? undefined : `${scope}.${reason}`;
  if (scoped !== undefined && tReasons.has(scoped)) return tReasons(scoped);
  if (tReasons.has(reason)) return tReasons(reason);
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

/** `error` with every field issue rewritten by `reasonText`, so whichever input or alert shows
 * it reads as a sentence; anything that isn't an `ApiError` comes back as it was. */
export function withReasonText(
  error: unknown,
  tReasons: ErrorCodeTranslator,
  scope?: string,
): unknown {
  if (!(error instanceof ApiError)) return error;
  return new ApiError({
    code: error.code,
    message: reasonText(error.message, tReasons, scope),
    status: error.status,
    url: error.url,
    details: error.details.map((detail) => ({
      ...detail,
      issue: reasonText(detail.issue, tReasons, scope),
    })),
    requestId: error.requestId,
    meta: error.meta,
  });
}

/** Where a reasoned refusal names its reason (`website_cms/errors.py`: `meta={"reason": …}`). */
const REASON_META_KEY = "reason";

/** A refusal's `meta.reason`, or `null` when it carries none (or isn't an `ApiError`). */
export function refusalReason(error: unknown): string | null {
  if (!(error instanceof ApiError)) return null;
  const reason = error.meta[REASON_META_KEY];
  return typeof reason === "string" ? reason : null;
}
