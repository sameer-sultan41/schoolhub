"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Badge, Button, EmptyState } from "@schoolhub/ui";
import { School } from "lucide-react";
import { useTranslations } from "next-intl";

import { LoadErrorCard } from "@/components/load-error-card";
import { useSignOut } from "@/hooks/use-sign-out";
import { ApiError } from "@/services";
import { useUnreadCount } from "@/features/portal/notifications/use-unread-count";
import { usePortalSummary } from "@/features/portal/use-portal-summary";
import { ChildSwitcher } from "./child-switcher";
import { PortalNav } from "./portal-nav";
import { NO_PORTAL_MODULES, SUMMARY_FREE_PATHS } from "./portal-nav-items";
import { useSelectedChild } from "./use-selected-child";

/** The API's 403 code when the school has the portal module off (`core/api/exceptions.py`). */
const MODULE_DISABLED_CODE = "module_disabled";

/** The portal's chrome: a header with the child switcher and sign-out, the nav, and the page.
 * Kept apart from the staff `Shell`: no sidebar, and every tab comes from `summary.modules`. */
export function PortalShell({ children }: { children: ReactNode }) {
  const t = useTranslations("portal.shell");
  const signOut = useSignOut();
  const pathname = usePathname();
  const summary = usePortalSummary();
  const { studentId } = useSelectedChild(summary.data?.children);
  // A failed summary leaves the module-free tabs, and their pages, usable.
  const modules = summary.data?.modules ?? (summary.isError ? NO_PORTAL_MODULES : undefined);
  const blocksPage = summary.isError && !SUMMARY_FREE_PATHS.includes(pathname);
  const portalDisabled =
    summary.error instanceof ApiError && summary.error.code === MODULE_DISABLED_CODE;

  // The badge is the inbox's own `:unread-count`, so a mark-read refreshes it (the summary's
  // count is only as fresh as the summary).
  const unread = useUnreadCount().data?.unread ?? 0;

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
        <PortalNav modules={modules} studentId={studentId} />
        {blocksPage && portalDisabled ? (
          <EmptyState
            icon={School}
            title={t("disabledTitle")}
            description={t("disabledDescription")}
          />
        ) : blocksPage ? (
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
