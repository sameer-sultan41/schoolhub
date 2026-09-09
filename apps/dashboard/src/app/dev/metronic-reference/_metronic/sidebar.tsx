"use client";

import { cn } from "@schoolhub/ui";
import { SidebarHeader } from "./sidebar-header";
import { SidebarMenu } from "./sidebar-menu";

/**
 * Copied from Metronic's own `sidebar.tsx`. `collapsed`/`onToggle` replace Metronic's own
 * `useSettings()` read — see `sidebar-header.tsx` for why.
 */
export function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  return (
    <div
      data-collapsed={collapsed}
      className={cn(
        "sidebar group shrink-0 flex-col items-stretch bg-background lg:fixed lg:top-0 lg:bottom-0 lg:z-20 lg:flex lg:border-e lg:border-border",
        collapsed ? "lg:w-20" : "lg:w-70",
      )}
    >
      <SidebarHeader collapsed={collapsed} onToggle={onToggle} />
      <div className="overflow-hidden">
        <div className={collapsed ? "w-20" : "w-70"}>
          <SidebarMenu />
        </div>
      </div>
    </div>
  );
}
