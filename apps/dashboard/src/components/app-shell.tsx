"use client";

import type { Tenant } from "@schoolhub/types";
import {
  Button,
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@schoolhub/ui";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { TenantTheme } from "@/components/tenant-theme";
import { useSession } from "@/hooks/use-session";
import { apiClient, logout } from "@/lib/auth";
import { LOGIN_PATH, PLATFORM_NAME, TENANT_QUERY_STALE_TIME_MS } from "@/lib/constants";
import { NAV_ITEMS } from "@/lib/nav-items";
import { canAccessModule } from "@/lib/permissions";
import { queryKeys } from "@/lib/query-client";

/**
 * Rendered inside SidebarProvider so it can reach useSidebar() — needed for exactly one
 * thing: closing the mobile drawer on navigation. SidebarProvider's own mobile state has
 * no navigation-awareness of its own (confirmed by a real e2e regression: without this,
 * the drawer stayed open behind the new page after a link click). setOpenMobile(false) is
 * a no-op on desktop, where there's no drawer to close.
 */
function DashboardNav({
  items,
  pathname,
  t,
}: {
  items: typeof NAV_ITEMS;
  pathname: string;
  t: (key: string) => string;
}) {
  const { setOpenMobile } = useSidebar();

  return (
    <nav aria-label={t("primary")}>
      <SidebarMenu>
        {items.map((item) => {
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
                  {t(item.key)}
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          );
        })}
      </SidebarMenu>
    </nav>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const t = useTranslations("nav");
  const tAuth = useTranslations("auth.session");
  const pathname = usePathname();
  const router = useRouter();
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

  const visibleItems = NAV_ITEMS.filter(
    (item) => item.module === "" || canAccessModule(user, item.module),
  );
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
          <p role="status" className="bg-warning px-4 py-2 text-center text-sm text-foreground">
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
              <DashboardNav items={visibleItems} pathname={pathname} t={t} />
            </SidebarContent>
          </Sidebar>

          <SidebarInset>
            <header className="flex items-center justify-between gap-4 border-b border-border px-6 py-3">
              <div className="flex min-w-0 items-center gap-2">
                {/* No desktop trigger: the sidebar is always visible on desktop, same as
                    before. Cmd/Ctrl+B still collapses it (SidebarProvider's own keyboard
                    shortcut, always active) — a new, reversible capability that comes
                    with using the real component rather than a hand-rolled one; nothing
                    prevents pressing it again to bring the sidebar back. */}
                <SidebarTrigger className="md:hidden" toggleLabel={t("primary")} />
                <span className="truncate text-sm text-muted-foreground">
                  {user?.full_name ?? ""}
                </span>
              </div>

              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  // onClick expects void, but logout() is async — and it intentionally
                  // rethrows anything that isn't the expected ApiError (see its own
                  // comment), so that rejection must be handled here rather than left to
                  // become an unhandled promise rejection. The user still always reaches
                  // /login: the unexpected case is logged, not swallowed or re-thrown.
                  void logout()
                    .catch((error: unknown) => {
                      console.error("Sign-out request failed unexpectedly:", error);
                    })
                    .finally(() => {
                      router.replace(LOGIN_PATH);
                    });
                }}
              >
                {t("signOut")}
              </Button>
            </header>

            {/* A plain div, not <main>: SidebarInset already renders the page's one <main>
                landmark. Nesting a second <main> inside it (as this was before) is
                invalid HTML and gives the accessibility tree two "main" landmarks, one
                of them wrongly containing the header (user name, sign-out). id stays
                here, not on SidebarInset, so the skip link still lands past the header
                and only at the actual content, exactly as before. */}
            <div id="main-content" className="flex-1 px-6 py-6">
              {children}
            </div>
          </SidebarInset>
        </SidebarProvider>
      </div>
    </TenantTheme>
  );
}
