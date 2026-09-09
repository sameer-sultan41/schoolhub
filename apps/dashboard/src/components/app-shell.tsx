"use client";

import {
  Sidebar,
  SidebarCollapseToggle,
  SidebarContent,
  SidebarHeader,
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
  cn,
} from "@schoolhub/ui";
import { useTranslations } from "next-intl";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { AppBreadcrumb } from "@/components/app-breadcrumb";
import { CommandPalette } from "@/components/command-palette";
import { DashboardNav } from "@/components/dashboard-nav";
import { LayoutControls } from "@/components/layout-controls";
import { ThemeToggle } from "@/components/theme-toggle";
import { UserMenu } from "@/components/user-menu";
import { PLATFORM_NAME } from "@/lib/constants";
import { NAV_GROUPS } from "@/lib/nav-items";
import { usePreference, usePreferenceActions } from "@/lib/preferences/preferences-provider";

/**
 * The authenticated chrome — layout only. Session/tenant resolution, permission-filtered
 * nav, the impersonation banner and sign-out plumbing are deliberately not wired here yet;
 * see docs/metronic-dashboard-shell.md's backlog. `UserMenu` renders with no user for now.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const t = useTranslations("nav");
  const pathname = usePathname();

  const sidebarVariant = usePreference("sidebar_variant");
  const sidebarCollapsible = usePreference("sidebar_collapsible");
  const sidebarState = usePreference("sidebar_state");
  const { setPreference } = usePreferenceActions();

  const tenantLabel = PLATFORM_NAME;

  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:m-2 focus:rounded-[var(--sh-radius)] focus:bg-surface focus:px-3 focus:py-2"
      >
        {t("skipToContent")}
      </a>

      <SidebarProvider
        className="min-h-0 flex-1"
        // Controlled, so Cmd/Ctrl+B and the header trigger both survive a reload: the
        // preference store is the persistence layer, not SidebarProvider's own state.
        open={sidebarState === "expanded"}
        onOpenChange={(open) => {
          setPreference("sidebar_state", open ? "expanded" : "collapsed");
        }}
      >
        <Sidebar
          variant={sidebarVariant}
          collapsible={sidebarCollapsible}
          mobileTitle={tenantLabel}
          mobileDescription={t("primary")}
          mobileCloseLabel={t("closeMenu")}
        >
          {/* Metronic's own sidebar-header.tsx row layout, ported from
              packages/ui/src/components/layouts/demo1/components/sidebar-header.tsx
              (reference-only — see docs/metronic-dashboard-shell.md). */}
          <SidebarHeader className="relative flex-row items-center justify-between px-3 py-5 lg:px-6">
            <span className="font-heading text-lg font-semibold text-foreground group-data-[collapsible=icon]:hidden">
              {tenantLabel}
            </span>
            <span
              aria-hidden="true"
              className="hidden size-8 shrink-0 items-center justify-center rounded-[var(--sh-radius)] bg-primary font-heading text-sm font-semibold text-primary-foreground group-data-[collapsible=icon]:flex"
            >
              {tenantLabel.slice(0, 1)}
            </span>
            <SidebarCollapseToggle toggleLabel={t("collapseSidebar")} />
          </SidebarHeader>
          <SidebarContent>
            <DashboardNav groups={NAV_GROUPS} pathname={pathname} />
          </SidebarContent>
        </Sidebar>

        <SidebarInset
          className={cn(
            "min-w-0 overflow-x-clip",
            "peer-data-[variant=inset]:border peer-data-[variant=inset]:border-border",
            "[html[data-content-layout=centered]_&>*]:mx-auto",
            "[html[data-content-layout=centered]_&>*]:w-full",
            "[html[data-content-layout=centered]_&>*]:max-w-[96rem]",
          )}
        >
          <header
            className={cn(
              "flex items-center gap-2 border-b border-chrome-border bg-chrome px-5 py-2.5 text-chrome-foreground lg:px-7.5",
              "[html[data-navbar-style=sticky]_&]:sticky",
              "[html[data-navbar-style=sticky]_&]:top-0",
              "[html[data-navbar-style=sticky]_&]:z-40",
              "[html[data-navbar-style=sticky]_&]:bg-chrome/80",
              "[html[data-navbar-style=sticky]_&]:backdrop-blur-md",
              "[html[data-navbar-style=sticky]_&]:rounded-t-[inherit]",
            )}
          >
            <SidebarTrigger toggleLabel={t("primary")} />
            <AppBreadcrumb />
            <div className="flex-1" />
            <CommandPalette />
            <LayoutControls />
            <ThemeToggle />
            <UserMenu user={null} />
          </header>

          <div id="main-content" className="flex-1 px-6 py-6">
            {children}
          </div>
        </SidebarInset>
      </SidebarProvider>
    </div>
  );
}
