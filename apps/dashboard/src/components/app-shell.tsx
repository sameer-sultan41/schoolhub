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
  cn,
  useSidebar,
} from "@schoolhub/ui";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { AppBreadcrumb } from "@/components/app-breadcrumb";
import { CommandPalette } from "@/components/command-palette";
import { LayoutControls } from "@/components/layout-controls";
import { TenantTheme } from "@/components/tenant-theme";
import { ThemeToggle } from "@/components/theme-toggle";
import { UserMenu } from "@/components/user-menu";
import { useSession } from "@/hooks/use-session";
import { apiClient } from "@/lib/auth";
import { PLATFORM_NAME, TENANT_QUERY_STALE_TIME_MS } from "@/lib/constants";
import { NAV_GROUPS, type NavGroup } from "@/lib/nav-items";
import { usePreference, usePreferenceActions } from "@/lib/preferences/preferences-provider";
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

/**
 * The authenticated chrome.
 *
 * The layout preferences below come from context, not a prop, and they are already right
 * on the server render: PreferencesProvider sits in the root layout, seeded from the same
 * cookie read, and SSR renders client components too. So the sidebar's variant, collapse
 * mode and open state are in the server's own markup rather than snapping into place on
 * hydration.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const t = useTranslations("nav");
  const tAuth = useTranslations("auth.session");
  const pathname = usePathname();
  const { user } = useSession();

  const sidebarVariant = usePreference("sidebar_variant");
  const sidebarCollapsible = usePreference("sidebar_collapsible");
  const sidebarState = usePreference("sidebar_state");
  const { setPreference } = usePreferenceActions();

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
        <SidebarProvider
          className="min-h-0 flex-1"
          // Controlled, so Cmd/Ctrl+B and the header trigger both survive a reload:
          // SidebarProvider keeps this in React state only, and this repo's port did
          // not carry shadcn's own sidebar_state cookie. Routing it through the
          // preference store puts the persistence policy in one place instead.
          open={sidebarState === "expanded"}
          onOpenChange={(open) => {
            setPreference("sidebar_state", open ? "expanded" : "collapsed");
          }}
        >
          {/*
            e2e's dashboard.page.ts locates the nav landmark by this exact role+name and
            scopes every nav link inside it; do not change the label. Sidebar renders this
            SAME children tree in both its desktop (always-visible) and mobile
            (Sheet-based) branches, so wrapping only the links here — not Sidebar's own
            header — keeps exactly one "Primary navigation" landmark at any viewport,
            the same discipline the previous hand-rolled implementation enforced by hand.
          */}
          <Sidebar
            variant={sidebarVariant}
            collapsible={sidebarCollapsible}
            // `side` is left at its default of "start" — the RTL bounding-box spec in
            // e2e/tests/dashboard/layout.spec.ts asserts the sidebar changes edge with
            // the document direction, which only a logical default does.
            mobileTitle={tenantLabel}
            mobileDescription={t("primary")}
            mobileCloseLabel={t("closeMenu")}
          >
            <SidebarHeader>
              {/* Two renderings of the same name, because the rail is 3rem wide: the full
                  name would simply overflow it, which is what it did the moment `icon`
                  became a selectable collapse mode. The initial keeps the collapsed rail
                  identifiable — a school with two campuses open in two tabs still needs to
                  tell them apart — and is aria-hidden because the name is already the
                  accessible name of the drawer and of the nav landmark beneath it. */}
              <span className="px-2 py-2 font-heading text-base font-semibold text-foreground group-data-[collapsible=icon]:hidden">
                {tenantLabel}
              </span>
              <span
                aria-hidden="true"
                className="hidden size-8 shrink-0 items-center justify-center rounded-[var(--sh-radius)] bg-primary font-heading text-sm font-semibold text-primary-foreground group-data-[collapsible=icon]:flex"
              >
                {tenantLabel.slice(0, 1)}
              </span>
            </SidebarHeader>
            <SidebarContent>
              <DashboardNav groups={visibleGroups} pathname={pathname} />
            </SidebarContent>
          </Sidebar>

          <SidebarInset
            className={cn(
              "min-w-0 overflow-x-clip",
              // The inset variant floats the content panel away from the viewport edge,
              // so it needs its own outline to read as a panel at all.
              "peer-data-[variant=inset]:border peer-data-[variant=inset]:border-border",
              // Content width is a preference, and it constrains the page's own children
              // rather than this element: the header must keep spanning the full width
              // even when the content below it is centred.
              "[html[data-content-layout=centered]_&>*]:mx-auto",
              "[html[data-content-layout=centered]_&>*]:w-full",
              // A literal rather than max-w-screen-2xl: Tailwind v4 removed the
              // screen-* max-width scale.
              "[html[data-content-layout=centered]_&>*]:max-w-[96rem]",
            )}
          >
            <header
              className={cn(
                // bg-background is not decoration: a sticky header with a transparent
                // background shows the page scrolling through it.
                "flex items-center gap-2 border-b border-border bg-background px-6 py-3",
                "[html[data-navbar-style=sticky]_&]:sticky",
                "[html[data-navbar-style=sticky]_&]:top-0",
                // z-40, not 50: the mobile sidebar renders as a Sheet whose overlay sits
                // at z-50, and a header above that would float over the open drawer.
                "[html[data-navbar-style=sticky]_&]:z-40",
                "[html[data-navbar-style=sticky]_&]:bg-background/80",
                "[html[data-navbar-style=sticky]_&]:backdrop-blur-md",
                // Inherit the panel's own top corners so the floating and inset variants
                // do not show a square header inside a rounded panel.
                "[html[data-navbar-style=sticky]_&]:rounded-t-[inherit]",
              )}
            >
              {/* Shown at every width now. Cmd/Ctrl+B collapsed the sidebar on desktop
                  before this too, but with no visible control it was a shortcut nobody
                  could discover — and the collapse mode is a preference now, so there is
                  something worth exercising. Still exactly one control with this name, at
                  every viewport, which is what the e2e mobile-drawer spec reaches for. */}
              <SidebarTrigger toggleLabel={t("primary")} />
              <AppBreadcrumb />
              <div className="flex-1" />
              <CommandPalette />
              <LayoutControls />
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
