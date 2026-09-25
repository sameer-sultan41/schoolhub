"use client";

import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";

import { cn } from "@schoolhub/ui";

import { SidebarHeader } from "@/app/(app)/shell/sidebar-header";
import { SidebarMenu } from "@/app/(app)/shell/sidebar-menu";
import { useSettings } from "@/app/(app)/shell/settings-provider";

// Ported verbatim from packages/ui's layouts/demo1/components/sidebar.tsx.
export function Sidebar() {
  const t = useTranslations("nav");
  const { settings } = useSettings();
  const pathname = usePathname();

  return (
    <div
      role="navigation"
      aria-label={t("primary")}
      // The desktop rail is one of three real `role="navigation"` landmarks on this
      // page (footer, breadcrumb) and the only one whose accessible name is itself
      // translated (ur) rather than fixed — a locale-independent E2E check has no
      // stable role+name pair to disambiguate it by. e2e/AGENTS.md's own bar for a
      // data-testid is "no accessible name at all"; this one has a name, just not a
      // usable one across locales, so it's a narrow, deliberate exception rather than
      // a literal match for that rule.
      data-testid="app-sidebar-nav"
      className={cn(
        "sidebar shrink-0 flex-col items-stretch bg-background lg:fixed lg:top-0 lg:bottom-0 lg:z-20 lg:flex lg:border-e lg:border-border",
        (settings.layouts.demo1.sidebarTheme === "dark" || pathname.includes("dark-sidebar")) &&
          "dark",
      )}
    >
      <SidebarHeader />
      <div className="overflow-hidden">
        <div className="w-(--sidebar-default-width)">
          <SidebarMenu />
        </div>
      </div>
    </div>
  );
}
