"use client";

import type { PermissionKey, Tenant } from "@schoolhub/types";
import { Button, cn } from "@schoolhub/ui";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
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
    staleTime: 10 * 60_000,
  });

  const visibleItems = NAV_ITEMS.filter(
    (item) => item.module === "" || canAccessModule(user, item.module),
  );

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
          <nav
            aria-label={t("primary")}
            className="hidden w-60 shrink-0 border-e border-border bg-surface md:block"
          >
            <div className="px-5 py-4">
              <span className="font-heading text-base font-semibold text-foreground">
                {tenant?.name ?? "SchoolHub"}
              </span>
            </div>
            <ul className="space-y-1 px-3 pb-4">
              {visibleItems.map((item) => {
                const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
                return (
                  <li key={item.key}>
                    <Link
                      href={item.href}
                      aria-current={isActive ? "page" : undefined}
                      className={cn(
                        "block rounded-[var(--sh-radius)] px-3 py-2 text-sm",
                        isActive
                          ? "bg-primary text-primary-foreground"
                          : "text-foreground hover:bg-muted",
                      )}
                    >
                      {t(item.key)}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>

          <div className="flex min-w-0 flex-1 flex-col">
            <header className="flex items-center justify-between gap-4 border-b border-border px-6 py-3">
              <span className="truncate text-sm text-muted-foreground">
                {user?.full_name ?? ""}
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={async () => {
                  await logout();
                  router.replace("/login");
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
