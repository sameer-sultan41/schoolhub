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
 * - `toggle_refused` names the flag (`meta.flag`). English adds the server's reason, the
 *   guard's own sentence (`apps/api/apps/platform_admin/flags/services.py`); Urdu leaves it out
 *   rather than mix languages, until the server sends a reason code to key a translation on.
 * - `limit_below_usage` counts the schools in `meta.over_usage`; a dialog that can resend with
 *   the acknowledgement lists them (`AcknowledgeOverUsageDialog`).
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
        // One breach per school and metric; the sentence counts schools.
        const schools = new Set(readOverUsage(error.meta).map((breach) => breach.tenant_id));
        return schools.size > 0 ? t("limitBelowUsage", { count: schools.size }) : undefined;
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
