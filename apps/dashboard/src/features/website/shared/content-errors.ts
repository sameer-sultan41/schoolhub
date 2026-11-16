"use client";

import { useCallback } from "react";
import { useTranslations } from "next-intl";

import { foldUnknownFieldErrors, type ErrorCodeTranslator } from "@/lib/error-message";
import { ApiError } from "@/services";

/**
 * The website content's business-rule refusals (`website_cms/errors.py::violation`) carry
 * `error.meta.reason` and an English `"<reason>: <sentence>"` under the field they concern. Each
 * reason the dashboard knows is shown in the viewer's language; any other keeps the server's text.
 */

/** Rewrites the detail a known `meta.reason` produced into `translate(reason)`; anything else
 * (another error, an unknown reason) comes back as it was. */
export function localiseContentError(
  error: unknown,
  translate: (reason: string) => string | undefined,
): unknown {
  if (!(error instanceof ApiError)) return error;
  const reason = error.meta.reason;
  if (typeof reason !== "string") return error;
  const message = translate(reason);
  if (message === undefined) return error;
  const prefix = `${reason}:`;
  return new ApiError({
    code: error.code,
    message,
    status: error.status,
    url: error.url,
    details: error.details.map((detail) =>
      detail.issue.startsWith(prefix) ? { ...detail, issue: message } : detail,
    ),
    requestId: error.requestId,
    meta: error.meta,
  });
}

/**
 * `localise(error)` for a form's mutation (the detail stays under its field), and
 * `asAction(run)` for a control with no fields (`PublishActions`, a confirm): the refusal is
 * localised and folded into the `non_field` sentence those show.
 */
export function useContentErrors() {
  const translations = useTranslations("website.contentErrors");
  const localise = useCallback(
    (error: unknown) => {
      // The reason is the server's, so it is looked up as a plain string key.
      const t: ErrorCodeTranslator = translations;
      return localiseContentError(error, (reason) => (t.has(reason) ? t(reason) : undefined));
    },
    [translations],
  );
  const asAction = useCallback(
    <T>(run: () => Promise<T>) =>
      async (): Promise<T> => {
        try {
          return await run();
        } catch (error) {
          throw foldUnknownFieldErrors(localise(error));
        }
      },
    [localise],
  );
  const withLocalised = useCallback(
    <A extends unknown[], T>(run: (...args: A) => Promise<T>) =>
      async (...args: A): Promise<T> => {
        try {
          return await run(...args);
        } catch (error) {
          throw localise(error);
        }
      },
    [localise],
  );
  return { localise, asAction, withLocalised };
}
