"use client";

import type { ReactNode } from "react";
import { Badge, Button } from "@schoolhub/ui";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";

import { LoadErrorCard } from "@/components/load-error-card";
import { Paths } from "@/config/paths";
import { Services } from "@/services";
import { usePortalSummary } from "@/features/portal/use-portal-summary";
import { ChildSwitcher } from "./child-switcher";
import { PortalNav } from "./portal-nav";
import { useSelectedChild } from "./use-selected-child";

/** The portal's chrome: a header with the child switcher and sign-out, the nav, and the page.
 * Kept apart from the staff `Shell`: no sidebar, and every tab comes from `summary.modules`. */
export function PortalShell({ children }: { children: ReactNode }) {
  const t = useTranslations("portal.shell");
  const router = useRouter();
  const summary = usePortalSummary();
  const { studentId } = useSelectedChild(summary.data?.children);

  function signOut() {
    // `logout` rethrows anything unexpected; the user still always reaches /login.
    void Services.auth
      .logout()
      .catch((error: unknown) => {
        console.error("Sign-out request failed unexpectedly:", error);
      })
      .finally(() => {
        router.replace(Paths.LOGIN);
      });
  }

  const unread = summary.data?.unread_notifications ?? 0;

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="border-b border-border">
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <span className="font-heading text-base font-semibold text-foreground">{t("title")}</span>
          <div className="flex flex-wrap items-center gap-3">
            {summary.data ? (
              <ChildSwitcher kids={summary.data.children} selectedStudentId={studentId} />
            ) : null}
            {unread > 0 ? <Badge variant="primary">{t("unread", { count: unread })}</Badge> : null}
            <Button variant="outline" size="sm" onClick={signOut}>
              {t("signOut")}
            </Button>
          </div>
        </div>
      </header>
      <div className="mx-auto w-full max-w-5xl space-y-5 px-4 pt-4 pb-8">
        <PortalNav modules={summary.data?.modules} studentId={studentId} />
        {summary.isError ? (
          <LoadErrorCard
            message={t("loadFailed")}
            onRetry={() => {
              void summary.refetch();
            }}
          />
        ) : (
          <main>{children}</main>
        )}
      </div>
    </div>
  );
}
