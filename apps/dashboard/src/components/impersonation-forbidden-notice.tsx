"use client";

import { useTranslations } from "next-intl";
import { Alert, AlertDescription, AlertTitle } from "@schoolhub/ui";

/**
 * What an account security screen (password, second factor) shows under impersonation instead of
 * its form: the API refuses those changes with 403 `impersonation_forbidden` (ADR-0037).
 */
export function ImpersonationForbiddenNotice() {
  const t = useTranslations("auth.impersonation.forbidden");
  return (
    <Alert variant="warning">
      <AlertTitle>{t("title")}</AlertTitle>
      <AlertDescription>{t("body")}</AlertDescription>
    </Alert>
  );
}
