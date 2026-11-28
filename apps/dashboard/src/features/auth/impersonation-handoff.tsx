"use client";

import { useEffect, useRef } from "react";
import { Alert, AlertDescription, AlertTitle, Button, Skeleton } from "@schoolhub/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useRouter, useSearchParams } from "next/navigation";

import { Paths } from "@/config/paths";
import { resolveErrorMessage } from "@/lib/error-message";
import { Services } from "@/services";
import { IMPERSONATION_LINK_KEYS } from "@/services/modules/auth/auth-constant";
import { isUnusableLinkError } from "@/services/modules/auth/auth-helper";
import { useLinkFragment } from "./use-link-fragment";

/**
 * `/impersonate` on a school's host (ADR-0037). Opened by the console's link
 * (`#school=<slug>&code=…`), it reads the single-use code from the fragment once, clears it from
 * the address bar, exchanges it for the session and opens the dashboard. Opened as
 * `?ended=1` (the session's grant ended, was released, or the tab was reloaded), it says the
 * session is over. The code is never logged, stored or put in a query key: it lives in the
 * fragment until this reads it, then only in the one request.
 */
export function ImpersonationHandoff() {
  const ended = useSearchParams().get("ended") === "1";
  return ended ? <SessionEnded /> : <CodeExchange />;
}

function CodeExchange() {
  const t = useTranslations("auth.impersonation");
  const tErrors = useTranslations("errors");
  const tCommon = useTranslations("common");
  const router = useRouter();
  const queryClient = useQueryClient();
  const link = useLinkFragment(IMPERSONATION_LINK_KEYS);

  const exchange = useMutation({
    mutationFn: (code: string) => Services.auth.exchangeImpersonationCode(code),
    // Nothing about the code outlives the request.
    gcTime: 0,
    onSuccess: () => {
      // Whatever this tab cached belonged to another session.
      queryClient.clear();
      router.replace(Paths.DASHBOARD);
    },
  });

  // One exchange per page: the code is single use, and Strict Mode runs effects twice.
  const sent = useRef(false);
  const { mutate } = exchange;
  useEffect(() => {
    if (!link || sent.current) return;
    sent.current = true;
    mutate(link.code);
  }, [link, mutate]);

  if (link === undefined) return <Skeleton className="h-40 w-full" />;
  if (link === null || isUnusableLinkError(exchange.error)) {
    return (
      <Alert variant="destructive">
        <AlertTitle>{t("invalidTitle")}</AlertTitle>
        <AlertDescription>{t("invalidBody")}</AlertDescription>
      </Alert>
    );
  }
  if (exchange.isError) {
    return (
      <div className="space-y-4">
        <Alert variant="destructive">
          <AlertDescription>
            {resolveErrorMessage(exchange.error, tErrors, t("failed"))}
          </AlertDescription>
        </Alert>
        <Button
          variant="outline"
          onClick={() => {
            mutate(link.code);
          }}
        >
          {tCommon("retry")}
        </Button>
      </div>
    );
  }
  return (
    <div className="space-y-3" aria-busy="true">
      <p className="text-sm text-muted-foreground">{t("signingIn")}</p>
      <Skeleton className="h-24 w-full" />
    </div>
  );
}

function SessionEnded() {
  const t = useTranslations("auth.impersonation");
  return (
    <Alert variant="info">
      <AlertTitle>{t("endedTitle")}</AlertTitle>
      <AlertDescription>{t("endedBody")}</AlertDescription>
    </Alert>
  );
}
