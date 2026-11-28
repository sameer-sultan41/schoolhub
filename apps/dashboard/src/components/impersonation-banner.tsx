"use client";

import { useCallback, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Button } from "@schoolhub/ui";
import { UserCog } from "lucide-react";

import { impersonationEndedPath } from "@/config/paths";
import { useCurrentUser } from "@/hooks/use-current-user";
import { useIsImpersonating } from "@/hooks/use-is-impersonating";
import { ApiError, Services } from "@/services";

/** How often the time left is recomputed. */
const TICK_MS = 15_000;
const MINUTE_MS = 60_000;

function isEnded(error: unknown): boolean {
  return error instanceof ApiError && error.code === "impersonation_ended";
}

/**
 * The persistent strip an impersonated session shows (ADR-0037), in the staff and portal shells:
 * whom the operator is acting as, who the operator is, the time left, and End session. Shown while
 * the session's token says impersonation, so it can't be dismissed or forgotten on a page.
 */
export function ImpersonationBanner() {
  return useIsImpersonating() ? <ImpersonationBar /> : null;
}

function ImpersonationBar() {
  const t = useTranslations("auth.impersonation.banner");
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: user } = useCurrentUser();
  const [now, setNow] = useState(() => Date.now());
  const [ending, setEnding] = useState(false);

  /** Leaves for the ended page, the session already dropped: nothing of it stays cached. */
  const leave = useCallback(() => {
    queryClient.clear();
    router.replace(impersonationEndedPath());
  }, [queryClient, router]);

  /** The API said the grant is gone (released, revoked, expired): drop the session here too. */
  const ended = useCallback(() => {
    Services.auth.forgetImpersonation();
    leave();
  }, [leave]);

  // Any read or write refused `impersonation_ended`, at any status: a 401 is also handled by the
  // client's 401 handler, a 403 only here.
  useEffect(() => {
    const queries = queryClient.getQueryCache().subscribe((event) => {
      if (event.type === "updated" && isEnded(event.query.state.error)) ended();
    });
    const mutations = queryClient.getMutationCache().subscribe((event) => {
      if (event.type === "updated" && isEnded(event.mutation.state.error)) ended();
    });
    return () => {
      queries();
      mutations();
    };
  }, [queryClient, ended]);

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, TICK_MS);
    return () => {
      clearInterval(timer);
    };
  }, []);

  const expiresAt = user?.impersonation ? Date.parse(user.impersonation.expires_at) : null;
  const expired = expiresAt !== null && expiresAt <= now;
  // Past its time the grant is over whether or not a request has said so yet.
  useEffect(() => {
    if (expired) ended();
  }, [expired, ended]);

  const end = () => {
    setEnding(true);
    void Services.auth
      .endImpersonation()
      .catch((error: unknown) => {
        console.error("Ending the support session failed unexpectedly:", error);
      })
      .finally(leave);
  };

  const minutesLeft = expiresAt === null ? null : Math.ceil((expiresAt - now) / MINUTE_MS);

  return (
    <section
      aria-label={t("label")}
      className="sticky bottom-0 z-40 border-t border-warning bg-warning text-warning-foreground"
    >
      <div className="mx-auto flex w-full flex-wrap items-center justify-between gap-3 px-4 py-2">
        <p className="flex items-center gap-2 text-sm">
          <UserCog className="size-4 shrink-0" aria-hidden="true" />
          <span>
            {user?.impersonation
              ? t("who", { name: user.full_name, operator: user.impersonation.by_name })
              : t("generic")}
          </span>
          {minutesLeft !== null && minutesLeft > 0 ? (
            <span className="font-medium">
              {minutesLeft > 1 ? t("timeLeft", { minutes: minutesLeft }) : t("lastMinute")}
            </span>
          ) : null}
        </p>
        <Button
          size="sm"
          variant="outline"
          onClick={end}
          isLoading={ending}
          loadingLabel={t("ending")}
        >
          {t("end")}
        </Button>
      </div>
    </section>
  );
}
