"use client";

import type { Tenant } from "@schoolhub/types";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@schoolhub/ui";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { AppBreadcrumb } from "@/components/app-breadcrumb";
import { TenantTheme } from "@/components/tenant-theme";
import { ThemeToggle } from "@/components/theme-toggle";
import { UserMenu } from "@/components/user-menu";
import { useSession } from "@/hooks/use-session";
import { apiClient } from "@/lib/auth";
import { PLATFORM_NAME, TENANT_QUERY_STALE_TIME_MS } from "@/lib/constants";
import { NAV_GROUPS, type NavGroup } from "@/lib/nav-items";
import { canAccessModule } from "@/lib/permissions";
import { queryKeys } from "@/lib/query-client";

/**
 * Rendered inside SidebarProvider so it can reach useSidebar() — needed for exactly one
 * thing: closing the mobile drawer on navigation. SidebarProvider's own mobile state has
 * no navigation-awareness of its own (confirmed by a real e2e regression: without this,
 * the drawer stayed open behind the new page after a link click). setOpenMobile(false) is
 * a no-op on desktop, where there's no drawer to close.
 */
function DashboardNav({ groups, pathname }: { groups: NavGroup[]; pathname: string }) {
  const t = useTranslations("nav");
  const { setOpenMobile } = useSidebar();

  return (
    // One landmark wrapping every group, not one per group: e2e's dashboard.page.ts scopes
    // every nav assertion to a single "Primary navigation" region, and a screen reader's
    // landmark list should offer one navigation here, not four.
    <nav aria-label={t("primary")}>
      {groups.map((group) => (
        <SidebarGroup key={group.key}>
          <SidebarGroupLabel>{t(`groups.${group.key}`)}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {group.items.map((item) => {
                const label = t(item.key);
                const Icon = item.icon;

                if (item.status === "planned") {
                  const badgeId = `nav-planned-${item.key}`;
                  return (
                    <SidebarMenuItem key={item.key}>
                      {/*
                        A button, never a Link: these five modules have no route, so a link
                        here navigates to a 404 that reads as a broken app rather than as a
                        feature that hasn't shipped. e2e's navLink() looks for links inside
                        this landmark, so rendering one would also hand every navigation
                        spec a target that 404s.

                        aria-disabled rather than `disabled`: a disabled button is removed
                        from the tab order entirely, so the one group of users who most
                        need to be told *why* nothing happens would never reach the badge
                        that says so.
                      */}
                      <SidebarMenuButton
                        type="button"
                        aria-disabled="true"
                        aria-describedby={badgeId}
                        title={t("plannedHint", { module: label })}
                      >
                        <Icon aria-hidden="true" />
                        <span>{label}</span>
                      </SidebarMenuButton>
                      <SidebarMenuBadge id={badgeId}>{t("planned")}</SidebarMenuBadge>
                    </SidebarMenuItem>
                  );
                }

                const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
                return (
                  <SidebarMenuItem key={item.key}>
                    <SidebarMenuButton asChild isActive={isActive}>
                      <Link
                        href={item.href}
                        aria-current={isActive ? "page" : undefined}
                        onClick={() => {
                          setOpenMobile(false);
                        }}
                      >
                        {/* aria-hidden and no label of its own: the accessible name of this
                            link must be exactly the module's name. An icon that contributes
                            so much as a word to it breaks every by-name nav locator in the
                            e2e suite, and makes the name wrong for a screen reader too. */}
                        <Icon aria-hidden="true" />
                        <span>{label}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      ))}
    </nav>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const t = useTranslations("nav");
  const tAuth = useTranslations("auth.session");
  const pathname = usePathname();
  const { user } = useSession();

  const { data: tenant } = useQuery({
    queryKey: queryKeys.tenant(),
    queryFn: async () => (await apiClient.get<Tenant>("/tenant")).data,
    enabled: Boolean(user),
    staleTime: TENANT_QUERY_STALE_TIME_MS,
    // The global default gcTime (query-client.ts) is 5 minutes — shorter than this
    // query's own 10-minute staleTime, so an unmount/remount anywhere in minutes 5-10
    // would evict the cache entry and refetch regardless of the data still being
    // nominally fresh. gcTime must be at least staleTime for staleTime to mean anything.
    gcTime: TENANT_QUERY_STALE_TIME_MS,
  });

  /**
   * `planned` entries are never permission-filtered: no permission key exists for a module
   * the API has not built, so gating them on one would hide every roadmap entry from every
   * user forever and make the whole disabled-with-a-badge treatment dead code. They expose
   * nothing — there is no route behind them to reach. Everything with a real screen behind
   * it is still gated exactly as before, and the API re-checks every call regardless.
   */
  const visibleGroups: NavGroup[] = NAV_GROUPS.map((group) => ({
    key: group.key,
    items: group.items.filter(
      (item) =>
        item.status === "planned" || item.module === "" || canAccessModule(user, item.module),
    ),
  }));
  const tenantLabel = tenant?.name ?? PLATFORM_NAME;

  return (
    <TenantTheme branding={tenant?.branding}>
      <div className="flex min-h-dvh flex-col">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:m-2 focus:rounded-[var(--sh-radius)] focus:bg-surface focus:px-3 focus:py-2"
        >
          {t("skipToContent")}
        </a>

        {user?.impersonated_by ? (
          // Named, not just a bare role="status": e2e reaches this banner by role, and a
          // second unnamed status anywhere in the tree (a toast, a future save indicator)
          // would make that locator ambiguous under Playwright's strict mode.
          //
          // The name is its OWN short key, not the sentence it contains. A live region
          // whose accessible name duplicates its content is announced twice — once as the
          // region's name, once as its text — so the short label is better for a screen
          // reader as well as being a stable thing for a locator to match on.
          <p
            role="status"
            aria-label={tAuth("impersonatingLabel")}
            className="bg-warning px-4 py-2 text-center text-sm text-warning-foreground"
          >
            {tAuth("impersonating")}
          </p>
        ) : null}

        {/*
          SidebarProvider's own base class sets min-h-svh, which would double-count against
          this column's own min-h-dvh above whenever the impersonation banner is also
          shown — min-h-0 overrides it (tailwind-merge resolves the conflict, className is
          spread last) so this row only ever grows to fill the remaining space.
        */}
        <SidebarProvider className="min-h-0 flex-1">
          {/*
            e2e's dashboard.page.ts locates the nav landmark by this exact role+name and
            scopes every nav link inside it; do not change the label. Sidebar renders this
            SAME children tree in both its desktop (always-visible) and mobile
            (Sheet-based) branches, so wrapping only the links here — not Sidebar's own
            header — keeps exactly one "Primary navigation" landmark at any viewport,
            the same discipline the previous hand-rolled implementation enforced by hand.
          */}
          <Sidebar
            mobileTitle={tenantLabel}
            mobileDescription={t("primary")}
            mobileCloseLabel={t("closeMenu")}
          >
            <SidebarHeader>
              <span className="px-2 py-2 font-heading text-base font-semibold text-foreground">
                {tenantLabel}
              </span>
            </SidebarHeader>
            <SidebarContent>
              <DashboardNav groups={visibleGroups} pathname={pathname} />
            </SidebarContent>
          </Sidebar>

          <SidebarInset>
            <header className="flex items-center gap-2 border-b border-border px-6 py-3">
              {/* No desktop trigger: the sidebar is always visible on desktop, same as
                  before. Cmd/Ctrl+B still collapses it (SidebarProvider's own keyboard
                  shortcut, always active) — a new, reversible capability that comes
                  with using the real component rather than a hand-rolled one; nothing
                  prevents pressing it again to bring the sidebar back. */}
              <SidebarTrigger className="md:hidden" toggleLabel={t("primary")} />
              <AppBreadcrumb />
              <div className="flex-1" />
              <ThemeToggle />
              <UserMenu user={user} />
            </header>

            {/* A plain div, not <main>: SidebarInset already renders the page's one <main>
                landmark. Nesting a second <main> inside it (as this was before) is
                invalid HTML and gives the accessibility tree two "main" landmarks, one
                of them wrongly containing the header (breadcrumb, theme, account). id
                stays here, not on SidebarInset, so the skip link still lands past the
                header and only at the actual content, exactly as before. */}
            <div id="main-content" className="flex-1 px-6 py-6">
              {children}
            </div>
          </SidebarInset>
        </SidebarProvider>
      </div>
    </TenantTheme>
  );
}
