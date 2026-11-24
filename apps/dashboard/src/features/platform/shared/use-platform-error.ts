"use client";

import { useCallback } from "react";
import { useTranslations } from "next-intl";

import { ApiError } from "@/services";
import { readOverUsage } from "@/services/modules/platform/platform-helper";

/**
 * The console's wording for refusals whose meaning rides in `meta`, for `describeError`
 * (`useConfirmAction`, `useFormDialogSubmit`). Every other code keeps the shared `errors.*`
 * message.
 *
 * - `toggle_refused` names the flag (`meta.flag`) beside the server's reason, which is the
 *   guard's own sentence (`apps/api/apps/platform_admin/flags/services.py`).
 * - `limit_below_usage` counts the breaches in `meta.over_usage`; a dialog that can resend with
 *   the acknowledgement shows the list itself (`AcknowledgeOverUsageDialog`).
 */
export function usePlatformErrorDescriber() {
  const t = useTranslations("platform.errors");

  return useCallback(
    (error: unknown): string | undefined => {
      if (!(error instanceof ApiError)) return undefined;
      if (error.code === "toggle_refused") {
        const flag = error.meta["flag"];
        return typeof flag === "string"
          ? t("toggleRefused", { flag, reason: error.message })
          : undefined;
      }
      if (error.code === "limit_below_usage") {
        const breaches = readOverUsage(error.meta);
        return breaches.length > 0 ? t("limitBelowUsage", { count: breaches.length }) : undefined;
      }
      return undefined;
    },
    [t],
  );
}

/** The 409 `limit_below_usage`'s breaches, or `null` for any other failure. */
export function overUsageOf(error: unknown) {
  if (!(error instanceof ApiError) || error.code !== "limit_below_usage") return null;
  const breaches = readOverUsage(error.meta);
  return breaches.length > 0 ? breaches : null;
}
