"use client";

import { usePathname } from "next/navigation";

import { cn } from "@schoolhub/ui";

import { SidebarHeader } from "./sidebar-header";
import { SidebarMenu } from "./sidebar-menu";
import { useSettings } from "./settings-provider";

// Ported verbatim from packages/ui's layouts/demo1/components/sidebar.tsx.
export function Sidebar() {
  const { settings } = useSettings();
  const pathname = usePathname();

  return (
    <div
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
