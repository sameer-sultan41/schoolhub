"use client";

import { useState } from "react";
import { Skeleton } from "@schoolhub/ui";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Paths } from "@/config/paths";
import { Services } from "@/services";
import { RESET_LINK_KEYS } from "@/services/modules/auth/auth-constant";
import { AuthPageHeader } from "./auth-page-header";
import { InvalidLinkNotice } from "./invalid-link-notice";
import { NewPasswordForm } from "./new-password-form";
import { useLinkFragment } from "./use-link-fragment";

/**
 * `/reset-password#school=<slug>&uid=…&token=…` (ADR-0033): sets a new password. The API
 * signs out every device; the person then signs in with the new password.
 */
export function ResetPasswordForm() {
  const t = useTranslations("auth.resetPassword");
  const router = useRouter();
  const link = useLinkFragment(RESET_LINK_KEYS);
  const [linkRejected, setLinkRejected] = useState(false);

  if (link === undefined) return <Skeleton className="h-64 w-full" />;
  if (link === null || linkRejected) return <InvalidLinkNotice kind="reset" />;

  return (
    <div className="space-y-5">
      <AuthPageHeader title={t("title")} subtitle={t("subtitle")} />
      <NewPasswordForm
        submit={(password) =>
          Services.auth.confirmPasswordReset({ ...link, new_password: password })
        }
        serverPasswordField="new_password"
        submitLabel={t("submit")}
        submittingLabel={t("submitting")}
        onSuccess={() => {
          toast.success(t("success"));
          router.replace(Paths.LOGIN);
        }}
        onInvalidLink={() => {
          setLinkRejected(true);
        }}
      />
    </div>
  );
}
