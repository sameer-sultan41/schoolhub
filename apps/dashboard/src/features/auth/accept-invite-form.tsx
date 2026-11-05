"use client";

import { useState } from "react";
import { Alert, AlertDescription, Button, Skeleton } from "@schoolhub/ui";
import { useQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Paths } from "@/config/paths";
import { resolveErrorMessage } from "@/lib/error-message";
import { formatDate } from "@/lib/helpers";
import { queryKeys } from "@/lib/query-client";
import { Services } from "@/services";
import { INVITATION_LINK_KEYS } from "@/services/modules/auth/auth-constant";
import { isUnusableLinkError } from "@/services/modules/auth/auth-helper";
import { AuthPageHeader } from "./auth-page-header";
import { InvalidLinkNotice } from "./invalid-link-notice";
import { NewPasswordForm } from "./new-password-form";
import { useLinkFragment } from "./use-link-fragment";

/**
 * `/accept-invite#school=<slug>&token=…` (ADR-0033): shows who the invitation is for, then
 * sets the password and activates the account. On success the person signs in as usual.
 */
export function AcceptInviteForm() {
  const t = useTranslations("auth.acceptInvite");
  const tErrors = useTranslations("errors");
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const link = useLinkFragment(INVITATION_LINK_KEYS);
  const [linkRejected, setLinkRejected] = useState(false);

  // A fixed key, never the token: the token lives only in `link` and the request body, and
  // `gcTime: 0` drops the cached preview as soon as the page unmounts.
  const preview = useQuery({
    queryKey: queryKeys.detail("auth", "invitation-preview", "current"),
    queryFn: () => Services.auth.previewInvitation(link as NonNullable<typeof link>),
    enabled: Boolean(link),
    retry: false,
    gcTime: 0,
  });

  if (link === undefined) return <Skeleton className="h-64 w-full" />;
  if (link === null || linkRejected || isUnusableLinkError(preview.error)) {
    return <InvalidLinkNotice kind="invitation" />;
  }

  if (preview.isPending) {
    return (
      <div className="space-y-3" aria-busy="true">
        <p className="text-sm text-muted-foreground">{t("loading")}</p>
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (preview.isError) {
    return (
      <div className="space-y-4">
        <Alert variant="destructive">
          <AlertDescription>
            {resolveErrorMessage(preview.error, tErrors, t("loadError"))}
          </AlertDescription>
        </Alert>
        <Button
          variant="outline"
          onClick={() => {
            void preview.refetch();
          }}
        >
          {tCommon("retry")}
        </Button>
      </div>
    );
  }

  const invitation = preview.data;
  return (
    <div className="space-y-5">
      <AuthPageHeader
        title={t("title")}
        subtitle={t("subtitle", { email: invitation.email, school: invitation.school_name })}
      />
      <p className="text-xs text-muted-foreground">
        {t("expires", { date: formatDate(invitation.expires_at, locale) })}
      </p>
      <NewPasswordForm
        submit={(password) => Services.auth.acceptInvitation({ ...link, password })}
        serverPasswordField="password"
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
