"use client";

import type { PermissionKey, Tenant } from "@schoolhub/types";
import {
  Button,
  cn,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from "@schoolhub/ui";
import { useQuery } from "@tanstack/react-query";
import { Menu } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { type ReactNode, useEffect, useState } from "react";
import { TenantTheme } from "@/components/tenant-theme";
import { useSession } from "@/hooks/use-session";
import { apiClient, logout } from "@/lib/auth";
import { canAccessModule } from "@/lib/permissions";
import { queryKeys } from "@/lib/query-client";

/**
 * Navigation mirrors the module docs one-to-one. Each entry names the module it belongs to,
 * so the menu is filtered by the user's effective permissions — a teacher never sees the
 * payroll link. Server-side RBAC still enforces every one of these.
 */
const NAV_ITEMS: { key: string; href: string; module: string; permission?: PermissionKey }[] = [
  { key: "dashboard", href: "/dashboard", module: "" },
  { key: "students", href: "/students", module: "students" },
  { key: "staff", href: "/staff", module: "staff" },
  { key: "attendance", href: "/attendance", module: "attendance" },
  { key: "academics", href: "/academics", module: "academics" },
  { key: "fees", href: "/fees", module: "fees" },
  { key: "admissions", href: "/admissions", module: "admissions" },
  { key: "communication", href: "/communication", module: "communication" },
  { key: "website", href: "/website", module: "website" },
];

interface NavListProps {
  items: typeof NAV_ITEMS;
  pathname: string;
  t: (key: string) => string;
  onNavigate?: () => void;
}

function NavList({ items, pathname, t, onNavigate }: NavListProps) {
  return (
    <ul className="space-y-1 px-3 pb-4">
      {items.map((item) => {
        const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <li key={item.key}>
            <Link
              href={item.href}
              aria-current={isActive ? "page" : undefined}
              onClick={onNavigate}
              className={cn(
                "block rounded-[var(--sh-radius)] px-3 py-2 text-sm",
                isActive ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-muted",
              )}
            >
              {t(item.key)}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const t = useTranslations("nav");
  const tAuth = useTranslations("auth.session");
  const pathname = usePathname();
  const router = useRouter();
  const { user } = useSession();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useEffect(() => {
    // mobileNavOpen is plain React state — it has no viewport binding of its own, so
    // opening the Sheet below `md` and then widening the window (or rotating a tablet)
    // past it without closing the Sheet first leaves BOTH navs mounted: the desktop
    // <nav> becomes visible purely via its own `md:block` CSS, while Radix keeps
    // rendering the Sheet's <nav> because nothing ever told it to close. Two identically
    // labelled "Primary navigation" landmarks would coexist — closing the Sheet the
    // instant the viewport crosses the same `md` breakpoint (768px, Tailwind's default,
    // unchanged in this repo) keeps it to exactly one at any given width.
    const query = window.matchMedia("(min-width: 768px)");
    const onChange = (event: MediaQueryListEvent) => {
      if (event.matches) setMobileNavOpen(false);
    };
    query.addEventListener("change", onChange);
    return () => {
      query.removeEventListener("change", onChange);
    };
  }, []);

  const { data: tenant } = useQuery({
    queryKey: queryKeys.tenant(),
    queryFn: async () => (await apiClient.get<Tenant>("/tenant")).data,
    enabled: Boolean(user),
    staleTime: 10 * 60_000,
  });

  const visibleItems = NAV_ITEMS.filter(
    (item) => item.module === "" || canAccessModule(user, item.module),
  );
  const tenantLabel = tenant?.name ?? "SchoolHub";

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

        <div className="flex flex-1">
          {/*
            Desktop sidebar — unchanged from before: still `hidden md:block`, still the
            ONE <nav aria-label="Primary navigation"> in the accessibility tree at any
            viewport where it's actually rendered. e2e's dashboard.page.ts locates it by
            this exact role+name and scopes every nav link inside it; do not touch this
            landmark's shape. w-64 (not the old w-60) gives Urdu labels — 20-40% longer
            than their English counterparts — a little more room before wrapping.
          */}
          <nav
            aria-label={t("primary")}
            className="hidden w-64 shrink-0 border-e border-border bg-surface md:block"
          >
            <div className="px-5 py-4">
              <span className="font-heading text-base font-semibold text-foreground">
                {tenantLabel}
              </span>
            </div>
            <NavList items={visibleItems} pathname={pathname} t={t} />
          </nav>

          <div className="flex min-w-0 flex-1 flex-col">
            <header className="flex items-center justify-between gap-4 border-b border-border px-6 py-3">
              <div className="flex min-w-0 items-center gap-2">
                {/*
                  Mobile nav trigger — the previous shell had NO replacement at all for the
                  sidebar below the md breakpoint; it simply vanished. Radix Dialog (which
                  Sheet wraps) doesn't mount SheetContent while closed, so a second
                  "Primary navigation" landmark alongside the desktop one above only ever
                  exists while this Sheet is actually open — which is why the matchMedia
                  effect above closes it the instant the viewport crosses md: without that,
                  opening this below md and then widening past it (or rotating a tablet)
                  without closing first would leave both navs mounted simultaneously.
                */}
                <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
                  <SheetTrigger asChild>
                    <Button variant="ghost" size="icon" className="md:hidden">
                      <Menu className="size-5" />
                      <span className="sr-only">{t("primary")}</span>
                    </Button>
                  </SheetTrigger>
                  <SheetContent side="start" closeLabel={t("closeMenu")} className="w-72 p-0">
                    <SheetTitle className="px-5 pt-5 pb-1">{tenantLabel}</SheetTitle>
                    <SheetDescription className="sr-only">{t("primary")}</SheetDescription>
                    <nav aria-label={t("primary")} className="pt-3">
                      <NavList
                        items={visibleItems}
                        pathname={pathname}
                        t={t}
                        onNavigate={() => {
                          setMobileNavOpen(false);
                        }}
                      />
                    </nav>
                  </SheetContent>
                </Sheet>

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
                      router.replace("/login");
                    });
                }}
              >
                {t("signOut")}
              </Button>
            </header>

            <main id="main-content" className="flex-1 px-6 py-6">
              {children}
            </main>
          </div>
        </div>
      </div>
    </TenantTheme>
  );
}
