"use client";

import { usePathname } from "next/navigation";

import { cn } from "@schoolhub/ui";

import { SidebarHeader } from "@/app/(app)/shell/sidebar-header";
import { SidebarMenu } from "@/app/(app)/shell/sidebar-menu";

// Ported verbatim from packages/ui's layouts/demo1/components/sidebar.tsx.
export function Sidebar() {
  const pathname = usePathname();

  return (
    <div
      className={cn(
        "sidebar shrink-0 flex-col items-stretch bg-background lg:fixed lg:top-0 lg:bottom-0 lg:z-20 lg:flex lg:border-e lg:border-border",
        pathname.includes("dark-sidebar") && "dark",
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
