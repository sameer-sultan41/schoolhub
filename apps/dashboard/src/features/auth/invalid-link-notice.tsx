"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import { Alert, AlertDescription, AlertTitle } from "@schoolhub/ui";

import { Paths } from "@/config/paths";

/**
 * What an unusable emailed link shows: missing, expired, used, revoked or for another
 * school all look the same here, as they do to the API (`invalid_link`). An invitation
 * can only be resent by the school; a reset link the person can request again.
 */
export function InvalidLinkNotice({ kind }: { kind: "invitation" | "reset" }) {
  const t = useTranslations("auth.link");

  return (
    <div className="space-y-5">
      <Alert variant="destructive">
        <AlertTitle>{t("invalidTitle")}</AlertTitle>
        <AlertDescription>
          {t("invalidBody")} {kind === "invitation" ? t("askResend") : null}
        </AlertDescription>
      </Alert>
      <div className="flex flex-col gap-2 text-sm">
        {kind === "reset" ? (
          <Link
            href={Paths.FORGOT_PASSWORD}
            className="text-primary underline-offset-4 hover:underline"
          >
            {t("requestNew")}
          </Link>
        ) : null}
        <Link href={Paths.LOGIN} className="text-primary underline-offset-4 hover:underline">
          {t("backToSignIn")}
        </Link>
      </div>
    </div>
  );
}
